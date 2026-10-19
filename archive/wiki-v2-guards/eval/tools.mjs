import { readFileSync } from "node:fs";
// The battery covers the optional destructive rules too.
process.env.JEVIS_ENABLE ??= "all";
import { evaluate } from "../src/engine.mjs";
import { decider, jevModel, lunaModel } from "../src/jev.mjs";
console.log(`decider: ${decider()} (${decider() === "luna" ? lunaModel() : jevModel() ?? "server default"})`);
const cases = JSON.parse(readFileSync(new URL("./tool-cases.json", import.meta.url), "utf8"));
let ok = 0;
let originalOk = 0;
let independentOk = 0;
let codeCases = 0;
const decisions = { true: 0, false: 0 };
const rows = await Promise.all(cases.map(async (c) => {
  const r = await evaluate({ event: "tool", state: { request: c.request, tool: "Bash", input: c.input, workspace: { git: true, files: [], empty: false } }, tool: "Bash", record: false, timeoutMs: 8000 });
  const deny = r.fired.find((e) => e.action === "deny")?.id ?? null;
  const code = r.code?.["safety/force-push"] ?? null;
  if (code !== null) { codeCases++; decisions[String(code)]++; }
  const pass = !r.error && deny === c.deny && (!Object.hasOwn(c, "code") || code === c.code);
  if (pass) ok += 1;
  if (pass && !c.regression) originalOk++;
  if (pass && !c.tuned) independentOk++;
  const detail = Object.keys(r.scores).filter((id) => id === "safety/force-push" || id === c.deny || r.scores[id] >= 0.5).map((id) => `${id.split("/")[1]} ${r.scores[id].toFixed(2)}${r.unless[id] !== undefined ? `/u${r.unless[id].toFixed(2)}` : ""}`).join("  ");
  return `${pass ? "ok  " : "MISS"} ${String(deny ?? "-").padEnd(30)} want ${String(c.deny ?? "-").padEnd(30)} code=${code} ${r.error ?? detail}  | ${c.input}`;
}));
console.log(rows.join("\n"));
console.log(`${ok}/${cases.length}`);
console.log(`Original cases: ${originalOk}/${cases.filter((c) => !c.regression).length}; regression cases: ${ok - originalOk}/${cases.filter((c) => c.regression).length}`);
console.log(`Independent original battery: ${independentOk}/${cases.filter((c) => !c.tuned).length}; tuning-contaminated cases excluded (${cases.filter((c) => c.tuned).length}). Real-data split: node eval/heldout/tools.mjs test`);
console.log(`destructive_git code-decided: ${codeCases}/${cases.length} cases (${decisions.true} true, ${decisions.false} false); positives still ask the decision model for permission.`);
if (ok !== cases.length) process.exitCode = 1;
