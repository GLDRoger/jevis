import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { evaluate } from "../../src/engine.mjs";
import { conditionsHold, loadWiki, WIKI_ROOT } from "../../src/wiki.mjs";
import { metrics } from "./metrics.mjs";
import { read, ROOT } from "./build.mjs";
import { guard, lessonDigest } from "./guard.mjs";
const split = process.argv[2] ?? "tune",
  phase = process.argv[3] ?? "before";
if (!["tune", "test"].includes(split) || !["before", "after", "sweep"].includes(phase))
  throw new Error("Usage: measure.mjs tune before|after|sweep OR test after");
guard();
if (split === "test" && phase !== "after") throw new Error("Test is read ONCE after tuning; evaluates frozen before and after together.");
if (split === "tune" && existsSync(new URL("test-read-receipt.json", ROOT))) throw new Error("Test already read. Tuning is closed.");
if (split === "test") {
  if (existsSync(new URL("test-read-receipt.json", ROOT))) throw new Error("Test report already exists; do not iterate.");
  writeFileSync(new URL("test-read-receipt.json", ROOT), JSON.stringify({ at: new Date().toISOString(), lessonDigest: lessonDigest() }), {
    flag: "wx",
    mode: 0o600,
  });
}
const baseline = JSON.parse(readFileSync(new URL("baseline-wiki.json", ROOT))),
  current = loadWiki([WIKI_ROOT]);
const rows = read(`stop-${split}.jsonl`);
const outFile = new URL(`stop-${split}-${phase}-scores.json`, ROOT);
async function run(wiki, tag) {
  const output = new Array(rows.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (next < rows.length) {
        let i = next++,
          r = rows[i];
        const result = await evaluate({ event: "stop", state: r.state, model: r.model, harness: r.harness, record: false, wiki, timeoutMs: 12000 });
        output[i] = { id: r.id, label: r.label, ...result, fired: result.fired.map((e) => e.id) };
        if (i % 40 === 0) console.error(`${tag} ${i}/${rows.length}`);
      }
    }),
  );
  return output;
}
function threshold(rows, wiki) {
  const states = new Map(read(`stop-${split}.jsonl`).map((r) => [r.id, r.state]));
  const old = new Map(baseline.entries.filter((e) => e.event === "stop").map((e) => [e.id, e]));
  for (const e of wiki.entries.filter((e) => e.event === "stop")) {
    const b = old.get(e.id);
    for (const key of ["ask", "yes", "no", "unless", "when"])
      if (JSON.stringify(e[key]) !== JSON.stringify(b?.[key])) throw new Error("Question or gate changed; fresh paired evaluation required: " + e.id);
  }
  return rows.map((r) => ({
    ...r,
    fired: wiki.entries
      .filter(
        (e) =>
          e.event === "stop" &&
          (r.scores[e.id] ?? 0) >= e.min &&
          (!e.unless || (r.unless[e.id] ?? 1) < e.unless_max) &&
          conditionsHold(e.when, { profile: r.profile, state: states.get(r.id) }),
      )
      .map((e) => e.id),
  }));
}
let result;
if (split === "test") {
  const before = await run(baseline, "test baseline"),
    after = threshold(before, current);
  result = { before, after, metricsBefore: metrics(before, baseline.entries), metricsAfter: metrics(after, current.entries) };
} else if (phase === "sweep") {
  const scored = JSON.parse(readFileSync(new URL("stop-tune-before-scores.json", ROOT)));
  result = {};
  for (const min of [0.9, 0.85, 0.8, 0.75, 0.7, 0.65]) {
    const rows = scored.rows.map((r) => ({
      ...r,
      fired: current.entries
        .filter(
          (e) =>
            e.event === "stop" &&
            (r.scores[e.id] ?? 0) >= min &&
            (!e.unless || (r.unless[e.id] ?? 1) < e.unless_max) &&
            conditionsHold(e.when, { profile: r.profile, state: read("stop-tune.jsonl").find((x) => x.id === r.id).state }),
        )
        .map((e) => e.id),
    }));
    result[min] = metrics(rows, current.entries);
  }
} else {
  const scored =
    phase === "before" ? await run(baseline, "tune before") : threshold(JSON.parse(readFileSync(new URL("stop-tune-before-scores.json", ROOT))).rows, current);
  result = { rows: scored, metrics: metrics(scored, current.entries) };
}
writeFileSync(outFile, JSON.stringify(result, null, 2), { mode: 0o600 });
console.log(
  JSON.stringify(split === "test" ? { before: result.metricsBefore, after: result.metricsAfter } : phase === "sweep" ? result : result.metrics, null, 2),
);
