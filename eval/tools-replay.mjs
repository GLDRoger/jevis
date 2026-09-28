import { writeFileSync, mkdirSync } from "node:fs";
import { replay, findSession } from "../src/replay.mjs";
const ids = process.argv.slice(2);
const rows = [];
let calls = 0;
for (const id of ids) {
  const r = await replay(findSession(id), { events: ["tool"], width: 10 });
  for (const t of r.turns) for (const x of t.tools) rows.push({ session: id.slice(0, 8), model: r.model, request: t.request, tool: x.tool, input: x.input, error: x.error, fired: x.fired.map((e) => `${e.action}:${e.id}@${x.scores[e.id]}${x.unless[e.id] !== undefined ? `/u${x.unless[e.id]}` : ""}`) });
}
mkdirSync(new URL("./out/", import.meta.url), { recursive: true });
writeFileSync(new URL("./out/tools.json", import.meta.url), JSON.stringify(rows, null, 1));
const denies = rows.filter((r) => r.fired.some((f) => f.startsWith("deny")));
console.log(`${rows.length} tool calls fired something; ${denies.length} denies; ${rows.filter((r) => r.error).length} errors`);
const by = {};
for (const r of rows) for (const f of r.fired) { const k = f.split("@")[0]; by[k] = (by[k] ?? 0) + 1; }
for (const [k, n] of Object.entries(by).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);
for (const d of denies) console.log(`DENY ${d.session} ${d.fired.join(" ")}\n   req: ${d.request.slice(0, 100)}\n   cmd: ${d.input.replace(/\s+/g, " ").slice(0, 160)}`);
