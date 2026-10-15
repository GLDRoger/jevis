import { existsSync, writeFileSync } from "node:fs";
import { evaluate } from "../../src/engine.mjs";
import { loadWiki } from "../../src/wiki.mjs";
import { read, ROOT } from "./build.mjs";
import { guard, toolFingerprint, toolTestReceipt } from "./guard.mjs";

const split = process.argv[2] ?? "test";
const flags = process.argv.slice(3);
if (!["tune", "test"].includes(split) || flags.some((arg) => arg !== "--allow-contaminated-test"))
  throw new Error("Usage: tools.mjs tune|test [--allow-contaminated-test]");
const allowContaminatedTest = flags.includes("--allow-contaminated-test");
if (split === "tune" && allowContaminatedTest) throw new Error("The override permits measurement, never tuning.");
if (split === "tune" && existsSync(new URL("tool-test-read-receipt.json", ROOT))) throw new Error("Tool test already read. Tuning is closed.");
const wiki = loadWiki();
const fingerprint = () => toolFingerprint({ wiki });
const manifest = guard(ROOT, undefined, { event: "tool", fingerprint, allowContaminatedTest });
if (split === "test") toolTestReceipt({ testHash: manifest.hashes["tool-test.jsonl"], fingerprint: fingerprint(), allowContaminatedTest });
const all = read(`tool-${split}.jsonl`);
const rows = all.filter((row) => row.label !== "unknown");
const out = new Array(rows.length);
let next = 0;
await Promise.all(
  Array.from({ length: 6 }, async () => {
    while (next < rows.length) {
      const index = next++,
        row = rows[index];
      // Historical state marks must not override today's canonical gate facts.
      const { marks: ignored, ...state } = row.state;
      const result = await evaluate({ event: "tool", tool: row.tool, model: row.model, harness: row.harness, state, wiki, record: false, timeoutMs: 12000 });
      out[index] = { id: row.id, label: row.label, error: result.error, fired: result.fired.map((entry) => entry.id) };
    }
  }),
);
const tp = out.filter((row) => row.label === "should-act" && !row.error && row.fired.length).length;
const fp = out.filter((row) => row.label === "not" && !row.error && row.fired.length).length;
const positives = rows.filter((row) => row.label === "should-act").length;
const negatives = rows.filter((row) => row.label === "not").length;
const report = {
  known: rows.length,
  unknown: all.length - rows.length,
  positives,
  negatives,
  tp,
  fp,
  errors: out.filter((row) => row.error).length,
  recall: positives ? tp / positives : null,
  falseActRate: negatives ? fp / negatives : null,
  rows: out,
};
writeFileSync(new URL(`tool-${split}-scores.json`, ROOT), JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ ...report, rows: undefined }, null, 2));
