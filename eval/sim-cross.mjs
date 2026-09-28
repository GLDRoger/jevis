/**
 * Cross-harness comparisons from finished eval/sim.mjs sessions: does Codex
 * with Jevis reach what bare Claude Code ships? Judged blind, like the pairs.
 *
 *   node eval/sim-cross.mjs /tmp/jevproof-confirm [scenario ...]
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compare } from "./sim-judge.mjs";

const [root, ...only] = process.argv.slice(2);
const names = only.length ? only : ["pottery", "dashboard", "hero"];
const load = (name, harness, seed, arm) => {
  const f = join(root, `${name}-${harness}-s${seed}-${arm}`, "result.json");
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
};
const seeds = [...new Set(readdirSync(root).map((d) => d.match(/-s(\d+)-(base|jevis)$/)?.[1]).filter(Boolean).map(Number))].sort();
// Each comparison: [label, side a, side b]. Claude Code bare is always side b.
const MATCHUPS = [
  ["Codex bare vs Claude Code bare", ["codex", "base"], ["claude", "base"]],
  ["Codex + Jevis vs Claude Code bare", ["codex", "jevis"], ["claude", "base"]],
];
const jobs = [];
for (const name of names) for (const seed of seeds) for (const [label, [ha, aa], [hb, ab]] of MATCHUPS) {
  const a = load(name, ha, seed, aa);
  const b = load(name, hb, seed, ab);
  if (a && b && !a.invalid && !b.invalid) jobs.push({ label, name, seed, a, b, flip: (jobs.length + seed) % 2 === 0 });
}
const out = [];
for (let i = 0; i < jobs.length; i += 3) {
  out.push(...(await Promise.all(jobs.slice(i, i + 3).map(async (j) => ({ label: j.label, name: j.name, seed: j.seed, minutes: [j.a.agentMs, j.b.agentMs].map((ms) => +(ms / 60000).toFixed(1)), verdict: await compare(j.name, j.a, j.b, { flip: j.flip, root }) })))));
}
writeFileSync(join(root, "cross.json"), JSON.stringify(out, null, 1));
for (const [label] of MATCHUPS) {
  const rows = out.filter((r) => r.label === label);
  const n = (w) => rows.filter((r) => r.verdict.winner === w).length;
  console.log(`\n${label}: side a wins ${n("a")}, ties ${n("tie")}, Claude Code bare wins ${n("b")}`);
  for (const r of rows) console.log(`  ${r.name} s${r.seed}: ${r.verdict.winner ?? r.verdict.error} ${r.verdict.margin ?? ""} (${r.minutes[0]} vs ${r.minutes[1]} min) ${r.verdict.why ?? ""}`);
}
