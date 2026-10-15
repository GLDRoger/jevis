/**
 * Cross-harness comparisons from finished eval/sim.mjs sessions: does Codex
 * with Jevis reach what bare Claude Code ships? Judged blind, like the pairs.
 *
 *   node eval/sim-cross.mjs /tmp/jevproof-confirm [scenario ...]
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compare } from "./sim-judge.mjs";
import { majority } from "./sim-stats.mjs";

const [root, ...only] = process.argv.slice(2);
const names = only.length ? only : ["pottery", "dashboard", "hero"];
const load = (name, harness, seed, repeat, arm) => {
  const suffix = repeat === 1 ? "" : `-r${repeat}`;
  const f = join(root, `${name}-${harness}-s${seed}${suffix}-${arm}`, "result.json");
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
};
const runs = [...new Map(readdirSync(root).flatMap((d) => {
  const m = d.match(/-s(\d+)(?:-r(\d+))?-(base|jevis)$/);
  return m ? [[`${m[1]}/${m[2] ?? 1}`, { seed: Number(m[1]), repeat: Number(m[2] ?? 1) }]] : [];
})).values()].sort((a, b) => a.seed - b.seed || a.repeat - b.repeat);
// Each comparison: [label, side a, side b]. Claude Code bare is always side b.
const MATCHUPS = [
  ["Codex bare vs Claude Code bare", ["codex", "base"], ["claude", "base"]],
  ["Codex + Jevis vs Claude Code bare", ["codex", "jevis"], ["claude", "base"]],
];
const jobs = [];
for (const name of names) for (const { seed, repeat } of runs) for (const [label, [ha, aa], [hb, ab]] of MATCHUPS) {
  const a = load(name, ha, seed, repeat, aa);
  const b = load(name, hb, seed, repeat, ab);
  if (a && b && !a.invalid && !b.invalid) jobs.push({ label, name, seed, repeat, a, b, identity: { harness: `${ha}/${aa}:${hb}/${ab}`, seed, repeat }, flip: (jobs.length + seed) % 2 === 0 });
}
const out = [];
for (let i = 0; i < jobs.length; i += 3) {
  out.push(...(await Promise.all(jobs.slice(i, i + 3).map(async (j) => ({ label: j.label, name: j.name, seed: j.seed, repeat: j.repeat, minutes: [j.a.agentMs, j.b.agentMs].map((ms) => +(ms / 60000).toFixed(1)), verdict: await compare(j.name, j.a, j.b, { identity: j.identity, flip: j.flip, root }) })))));
}
writeFileSync(join(root, "cross.json"), JSON.stringify(out, null, 1));
for (const [label] of MATCHUPS) {
  const raw = out.filter((r) => r.label === label);
  const groups = new Map();
  for (const r of raw) {
    const key = JSON.stringify([r.name, r.seed]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const rows = [...groups.values()].map((rs) => ({ ...rs[0], verdict: majority(rs.map((r) => r.verdict)), repeats: rs.length }));
  const n = (w) => rows.filter((r) => r.verdict.winner === w).length;
  console.log(`\n${label}: side a wins ${n("a")}, ties ${n("tie")}, Claude Code bare wins ${n("b")}, invalid ${rows.filter((r) => r.verdict.error).length} (${raw.length} paired runs aggregated)`);
  for (const r of raw) console.log(`  ${r.name} s${r.seed} r${r.repeat}: ${r.verdict.winner ?? r.verdict.error} ${r.verdict.margin ?? ""} (${r.minutes[0]} vs ${r.minutes[1]} min) ${r.verdict.why ?? ""}`);
}
