import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { eachJsonl } from "../../src/transcript.mjs";
import { loadWiki, WIKI_ROOT } from "../../src/wiki.mjs";
import { ROOT, read } from "./build.mjs";
const acted = new Set();
eachJsonl(join(homedir(), ".jevis/log.jsonl"), (r) => (r.acted ?? []).forEach((id) => acted.add(id)));
const near = readFileSync(process.argv[2] ?? new URL("near-stats.txt", ROOT), "utf8");
const stats = new Map();
for (const line of near.split("\n")) {
  const m = line.match(/^(\S+\/\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)/);
  if (m) stats.set(m[1], { asked: +m[2], fires: +m[3], near: +m[4], stoodDown: +m[5], max: +m[6] });
}
const wiki = loadWiki([WIKI_ROOT]);
const rows = wiki.entries
  .filter((e) => !acted.has(e.id))
  .map((e) => {
    const s = stats.get(e.id) ?? { asked: 0, fires: 0, near: 0, stoodDown: 0, max: null };
    const over = s.near > 0 || s.stoodDown > 0;
    const classification = over ? "over-gated" : e.id === "slop/countdown" ? "dead" : "fine-but-rare";
    let decision =
      e.event === "tool"
        ? over
          ? "Owner recommendation: inspect real near-miss edits and gate marks before lowering; do not tune tool rules on contaminated batteries."
          : "Keep unchanged; no near-miss evidence supports a change."
        : e.id === "verification/fixed-without-repro"
          ? "min 0.90 → 0.75: one tune catch, zero false blocks."
          : over
            ? "Retain: tune evidence does not support a lower threshold without new false blocks, or near miss lacks independently labeled prompt evidence."
            : "Keep: plausible specialized trigger, no near misses; no unsupported threshold change.";
    if (e.id === "slop/countdown") decision = "Recommend retirement review only: 64 asks, max 0.03, no countdown in this sample. Do not delete.";
    return { id: e.id, event: e.event, classification, ...s, when: e.when, decision, readBodyCharacters: e.body.length };
  });
writeFileSync(new URL("lesson-audit.json", ROOT), JSON.stringify(rows, null, 2), { mode: 0o600 });
const annotations = JSON.parse(readFileSync(new URL("annotations.json", ROOT))).subagent;
const subs = read("subagent-audit.jsonl").map((row, index) => ({
  ...row,
  relevant: !annotations.irrelevant.includes(index),
  verdict: annotations.automatic.includes(index)
    ? "automatic task; note irrelevant"
    : annotations.irrelevant.includes(index)
      ? "worker or continuation; redundant note"
      : "bounded direct work; cost caution relevant",
  behavior: row.transcript ? "No delegation observed; no untreated counterfactual, so no causal claim." : "Transcript unavailable; behavior unknown.",
}));
writeFileSync(new URL("subagent-audit-reviewed.json", ROOT), JSON.stringify(subs, null, 2), { mode: 0o600 });
const count = (c) => rows.filter((r) => r.classification === c).length;
console.log(
  JSON.stringify(
    {
      neverActed: rows.length,
      overGated: count("over-gated"),
      dead: count("dead"),
      fineButRare: count("fine-but-rare"),
      subagentRelevant: subs.filter((r) => r.relevant).length,
      subagentIrrelevant: subs.filter((r) => !r.relevant).length,
      behaviorObserved: subs.filter((r) => r.transcript).length,
    },
    null,
    2,
  ),
);
// Content-free publishable audit table.
writeFileSync(
  new URL("./AUDIT.md", import.meta.url),
  "# Never-acted lesson audit\n\nLive inventory: " +
    rows.length +
    " (not the earlier 44); 20 slop, 8 verification, 5 workflow, 4 safety, 4 design, 2 engineering. Current-wording near misses only. Historical non-actions and reconstructed would-fires are different measurements.\n\n| Lesson | Event | Class | Near | Stood down | Decision |\n|---|---|---|---:|---:|---|\n" +
    rows.map((r) => `| ${r.id} | ${r.event} | ${r.classification} | ${r.near} | ${r.stoodDown} | ${r.decision} |`).join("\n") +
    "\n",
);
