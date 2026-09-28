/**
 * A local gallery of the pages from eval/sim.mjs design sessions: every task
 * and seed, in all four arms (Codex bare, Codex + Jevis, Claude Code bare,
 * Claude Code + Jevis), live in desktop and phone frames, with a blind mode.
 *
 *   node eval/gallery.mjs [out dir] [sim root ...]
 *   python3 -m http.server 8765 --bind 127.0.0.1 --directory /tmp/jevgallery
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SCENARIOS } from "./sim-scenarios.mjs";

const [out = "/tmp/jevgallery", ...roots] = process.argv.slice(2);
const ROOTS = roots.length ? roots : ["/tmp/jevproof-confirm", "/tmp/jevproof-fix", "/tmp/jevproof-craft"].filter((r) => existsSync(r));
const ARMS = [
  ["codex", "base", "Codex"],
  ["codex", "jevis", "Codex + Jevis"],
  ["claude", "base", "Claude Code"],
  ["claude", "jevis", "Claude Code + Jevis"],
];
const read = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null);

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "pages"), { recursive: true });
const sets = [];
for (const root of ROOTS) {
  const round = root.includes("craft") ? "motion and copy notes" : root.includes("fix") ? "after fixes" : "confirmation";
  const cross = read(join(root, "cross.json")) ?? [];
  for (const name of Object.keys(SCENARIOS).filter((n) => SCENARIOS[n].kind === "page")) {
    for (let seed = 1; seed <= 12; seed++) {
      const variants = [];
      for (const [harness, arm, label] of ARMS) {
        const dir = join(root, `${name}-${harness}-s${seed}-${arm}`);
        const r = read(join(dir, "result.json"));
        if (!r || r.invalid || !existsSync(join(dir, "proj", "index.html"))) continue;
        const id = `${root.split("/").pop()}-${name}-s${seed}-${harness}-${arm}`;
        cpSync(join(dir, "proj"), join(out, "pages", id), { recursive: true, filter: (p) => !/\/\.(git|codex|claude)(\/|$)/.test(p) && !p.includes("/node_modules/") });
        const pair = read(join(root, `${name}-${harness}-s${seed}-verdict.json`));
        variants.push({
          id,
          label,
          harness,
          arm,
          minutes: +(r.agentMs / 60000).toFixed(1),
          turns: r.turns.length,
          satisfied: r.satisfied,
          followups: r.turns.slice(1).map((t) => t.message.slice(0, 400)),
          pair: pair?.winner ? { won: pair.winner === arm, tie: pair.winner === "tie", margin: pair.margin, why: pair.why } : null,
        });
      }
      if (variants.length < 2) continue;
      const vsClaude = cross.filter((c) => c.name === name && c.seed === seed).map((c) => ({ label: c.label, winner: c.verdict.winner, margin: c.verdict.margin, why: c.verdict.why }));
      sets.push({ key: `${name}-s${seed}`, name, seed, round, prompt: SCENARIOS[name].prompt, variants, cross: vsClaude });
    }
  }
}

const page = readFileSync(new URL("./gallery.html", import.meta.url), "utf8").replace("/*DATA*/null", JSON.stringify(sets));
writeFileSync(join(out, "index.html"), page);
console.log(`${sets.length} sets, ${sets.reduce((n, s) => n + s.variants.length, 0)} pages in ${out}`);
