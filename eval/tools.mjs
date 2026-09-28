import { readFileSync } from "node:fs";
// The battery covers the optional destructive rules too.
process.env.JEVIS_ENABLE ??= "all";
import { evaluate } from "../src/engine.mjs";
const cases = JSON.parse(readFileSync(new URL("./tool-cases.json", import.meta.url), "utf8"));
let ok = 0;
const rows = await Promise.all(cases.map(async (c) => {
  const r = await evaluate({ event: "tool", state: { request: c.request, tool: "Bash", input: c.input, workspace: { git: true, files: [], empty: false } }, tool: "Bash", record: false, timeoutMs: 8000 });
  const deny = r.fired.find((e) => e.action === "deny")?.id ?? null;
  const pass = deny === c.deny;
  if (pass) ok += 1;
  const detail = Object.keys(r.scores).map((id) => `${id.split("/")[1]} ${r.scores[id].toFixed(2)}${r.unless[id] !== undefined ? `/u${r.unless[id].toFixed(2)}` : ""}`).join("  ");
  return `${pass ? "ok  " : "MISS"} ${String(deny ?? "-").padEnd(30)} want ${String(c.deny ?? "-").padEnd(30)} ${detail}  | ${c.input.slice(0, 60)}`;
}));
console.log(rows.join("\n"));
console.log(`${ok}/${cases.length}`);
