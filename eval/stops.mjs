import { readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { replay } from "../src/replay.mjs";

/**
 * Replays turn endings from recent real sessions through the stop entries.
 * A block is judged against what the user said next: a block before a user
 * complaint about the same thing is a catch; a block before "thanks, next" is noise.
 */
const [codexN = 40, claudeN = 20] = process.argv.slice(2).map(Number);
const walk = (dir, out = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory() && e.name !== "subagents") walk(p, out);
    else if (e.name.endsWith(".jsonl")) out.push(p);
  }
  return out;
};
const recent = (files, n) => files.map((f) => ({ f, m: statSync(f).mtimeMs, s: statSync(f).size })).filter((x) => x.s > 20000).sort((a, b) => b.m - a.m).slice(0, n).map((x) => x.f);
const sessions = [...recent(walk(join(homedir(), ".codex", "sessions", "2026", "09")), codexN), ...recent(walk(join(homedir(), ".claude", "projects")).filter((f) => !f.includes("/subagents/")), claudeN)];
const rows = [];
let turns = 0;
for (const path of sessions) {
  let r;
  try {
    r = await replay(path, { events: ["stop"], width: 8 });
  } catch (e) {
    console.error(`skip ${path}: ${e.message}`);
    continue;
  }
  r.turns.forEach((t, i) => {
    if (!t.stop) return;
    turns += 1;
    if (t.stop.error) return rows.push({ path, turn: t.turn, error: t.stop.error });
    if (!t.stop.fired.length) return;
    rows.push({ path: path.split("/").pop(), model: r.model, turn: t.turn, request: t.request, final: t.stop.final, fired: t.stop.fired.map((e) => `${e.id}@${t.stop.scores[e.id]}`), next: r.turns[i + 1]?.request ?? "(session ended)" });
  });
}
mkdirSync(new URL("./out/", import.meta.url), { recursive: true });
writeFileSync(new URL("./out/stops.json", import.meta.url), JSON.stringify(rows, null, 1));
const fired = rows.filter((r) => r.fired);
const byEntry = {};
for (const r of fired) for (const f of r.fired) byEntry[f.split("@")[0]] = (byEntry[f.split("@")[0]] ?? 0) + 1;
console.log(`${sessions.length} sessions, ${turns} turn endings, ${fired.length} would block (${((fired.length / turns) * 100).toFixed(1)}%), ${rows.filter((r) => r.error).length} errors`);
for (const [id, n] of Object.entries(byEntry).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${id}`);
