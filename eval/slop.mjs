import { evaluate } from "../src/engine.mjs";
import { inputMarks, toolInput } from "../src/context.mjs";
import { CASES } from "./slop-cases.mjs";

/** Live Jev over the slop battery. A case passes when the slop denies that fire are exactly the ones it wants. */
const only = process.argv[2];
let ok = 0;
let codeCases = 0;
const decisions = {};
const rows = await Promise.all(CASES.filter((c) => !only || c.name.includes(only)).map(async (c) => {
  const input = toolInput(c.tool, c.input);
  const r = await evaluate({ event: "tool", state: { request: c.request, tool: c.tool, input, marks: inputMarks(input, { tool: c.tool }), workspace: { git: true, files: [], empty: false } }, tool: c.tool, record: false, timeoutMs: 10000 });
  if (r.error) return `ERR  ${c.name}: ${r.error}`;
  if (Object.keys(r.code ?? {}).length) codeCases++;
  for (const [id, decision] of Object.entries(r.code ?? {})) {
    decisions[id] ??= { true: 0, false: 0 };
    decisions[id][String(decision)]++;
  }
  const got = r.fired.filter((e) => e.action === "deny").map((e) => e.id).sort();
  const want = [...c.want].sort();
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (pass) ok += 1;
  const near = Object.entries(r.scores).filter(([id, p]) => id.startsWith("slop/") && (p >= 0.5 || want.includes(id))).map(([id, p]) => `${id.slice(5)} ${p.toFixed(2)}${r.unless[id] !== undefined ? `/u${r.unless[id].toFixed(2)}` : ""}`).join("  ");
  return `${pass ? "ok  " : "MISS"} ${c.name.padEnd(32)} got [${got.map((g) => g.slice(5)).join(",")}] want [${want.map((g) => g.slice(5)).join(",")}]  ${near}  (${r.ms} ms)`;
}));
console.log(rows.join("\n"));
console.log(`${ok}/${rows.length}`);
console.log(`At least one code-decided lesson: ${codeCases}/${rows.length} cases; positives still ask Jev for permission.`);
console.log(`Code decisions by lesson: ${JSON.stringify(decisions)}`);
if (ok !== rows.length) process.exitCode = 1;
