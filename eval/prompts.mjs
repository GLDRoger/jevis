import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { evaluate } from "../src/engine.mjs";
import { loadWiki } from "../src/wiki.mjs";

/**
 * The 220 hand-labeled prompts from real sessions (Sep 2026; kept out of git: they are the user's words).
 * Labels: C new creative piece, U change to an existing UI's look, E engineering, N no change, D delegate.
 * Reports how each axis separates the labels, and where each prompt entry fires by label.
 */
const rows = readFileSync(new URL("./prompts.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(JSON.parse);
const wiki = loadWiki();
const out = new Array(rows.length);
let next = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (next < rows.length) {
    const i = next++;
    const r = rows[i];
    const state = { request: r.state.request, previous_request: null, attachments: r.state.attachments ?? [], workspace: { git: r.state.workspace?.code_repo ?? false, files: [], empty: r.state.workspace?.empty_folder ?? false }, agent: { harness: "Codex", model: "gpt-6-sol", origin: "person" } };
    const res = await evaluate({ event: "prompt", state, model: "gpt-6-sol", record: false, wiki, timeoutMs: 8000 });
    out[i] = { id: r.id, label: r.accept[0], accept: r.accept, request: r.state.request.slice(0, 140), error: res.error, profile: res.profile, scores: res.scores, fired: res.fired.map((e) => e.id) };
  }
}));
mkdirSync(new URL("./out/", import.meta.url), { recursive: true });
writeFileSync(new URL("./out/prompts.json", import.meta.url), JSON.stringify(out, null, 1));
const ok = out.filter((o) => !o.error);
console.log(`${ok.length}/${out.length} answered`);
const labels = ["C", "U", "E", "N", "D"];
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
console.log(`axis means by label      ${labels.map((l) => `${l} (${ok.filter((o) => o.label === l).length})`.padStart(8)).join("")}`);
for (const axis of Object.keys(ok[0]?.profile ?? {})) console.log(`  ${axis.padEnd(22)}${labels.map((l) => mean(ok.filter((o) => o.label === l).map((o) => o.profile[axis])).toFixed(2).padStart(8)).join("")}`);
console.log("entry fires by label");
for (const e of wiki.entries.filter((x) => x.event === "prompt")) console.log(`  ${e.id.padEnd(40)}${labels.map((l) => `${ok.filter((o) => o.label === l && o.fired.includes(e.id)).length}/${ok.filter((o) => o.label === l).length}`.padStart(8)).join("")}`);
