import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { cost, formatCost } from "../src/cost.mjs";
import { readConfig } from "../src/config.mjs";

const home = mkdtempSync(join(tmpdir(), "jevis-cost-"));
after(() => rmSync(home, { recursive: true, force: true }));
const since = Date.parse("2026-10-01T00:00:00Z");
// The last 24 hours run from Oct 5 13:00 UTC: one recorded tool call (Oct 5 19:30 UTC) and one logged stop.
const now = Date.parse("2026-10-06T13:00:00Z");
const call = (day, event, input, output, extra = {}) => ({ at: `2026-10-${day}T12:00:00Z`, event, usage: { input_tokens: input, output_tokens: output }, ...extra });
mkdirSync(join(home, "jev"));
const writeRows = (file, rows) => writeFileSync(file, rows.map(JSON.stringify).join("\n") + "\nnot json\n");
writeRows(join(home, "jev", "calls.jsonl"), [
  call("01", "prompt", 100, 10, { decider: "jev" }), call("01", "tool", 200, 20, { decider: "openai" }),
  call("03", "tool", 300, 30, { error: "timeout" }), call("04", "stop", 400, 40), call("04", "review", 500, 50),
  call("05", "tool", 600, 60, { at: "2026-10-06T01:00:00+05:30" }), call("05", "prompt", 0, 0, { usage: undefined }),
  { at: "2026-09-30T23:59:59Z", event: "tool", usage: { input_tokens: 9999, output_tokens: 9999 } },
  { at: "not a date", event: "tool" }, call("07", "approve", 9999, 9999), null,
]);
writeRows(join(home, "log.jsonl"), [
  call("01", "prompt", 9999, 9999, { ms: 1 }), call("01", "tool", 9999, 9999, { ms: 2 }),
  call("03", "tool", 0, 0, { ms: 3 }), call("04", "stop", 0, 0, { ms: 4 }), call("04", "review", 0, 0, { ms: 100 }),
  call("05", "tool", 0, 0, { ms: 5 }), call("05", "prompt", 0, 0, { ms: 6 }), call("05", "tool", 0, 0, { ms: 7, error: "timeout" }),
  call("06", "stop", 0, 0, { ms: 1 }),
  call("07", "tool", 0, 0, { ms: 10, skipped: "no entries" }), call("07", "tool", 0, 0, { ms: 0 }),
  call("07", "tool", 0, 0, { ms: "5" }), call("07", "tool", 0, 0, { ms: -1 }),
  { at: "2026-09-30T23:59:59Z", event: "tool", ms: 10 }, null,
]);

function withPrices(input, output, run) {
  const saved = [process.env.JEVIS_PRICE_IN, process.env.JEVIS_PRICE_OUT];
  for (const [key, value] of [["JEVIS_PRICE_IN", input], ["JEVIS_PRICE_OUT", output]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  try { return run(); } finally {
    for (const [i, key] of ["JEVIS_PRICE_IN", "JEVIS_PRICE_OUT"].entries()) {
      if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i];
    }
  }
}

test("cost: UTC days, per-event totals, independent log call counts and recent-three-day projection", () => withPrices(undefined, undefined, () => {
  const result = cost({ home, since, now });
  assert.deepEqual(result.days.map((day) => [day.date, day.calls, day.logCalls, day.input_tokens, day.output_tokens]), [
    ["2026-10-01", 2, 2, 300, 30], ["2026-10-03", 1, 1, 300, 30], ["2026-10-04", 2, 1, 900, 90],
    ["2026-10-05", 2, 3, 600, 60], ["2026-10-06", 0, 1, 0, 0],
  ]);
  assert.deepEqual([result.totals.calls, result.totals.logCalls, result.totals.input_tokens, result.totals.output_tokens], [7, 8, 2100, 210]);
  assert.deepEqual(result.totals.events, {
    prompt: { calls: 2, logCalls: 2, input_tokens: 100, output_tokens: 10, dollars: null },
    tool: { calls: 3, logCalls: 4, input_tokens: 1100, output_tokens: 110, dollars: null },
    stop: { calls: 1, logCalls: 2, input_tokens: 400, output_tokens: 40, dollars: null },
    review: { calls: 1, logCalls: 0, input_tokens: 500, output_tokens: 50, dollars: null },
  });
  assert.deepEqual(result.averages.prompt, { input_tokens: 50, output_tokens: 5 });
  assert.equal(result.averages.tool.input_tokens, 1100 / 3);
  assert.equal(result.projection.basedOn, "last 24 hours");
  assert.deepEqual([result.projection.calls, result.projection.logCalls, result.projection.input_tokens, result.projection.output_tokens], [30, 30, 18000, 1800]);
  assert.equal(result.prices, null);
  const formatted = formatCost(result);
  assert.match(formatted, /Set JEVIS_PRICE_IN and JEVIS_PRICE_OUT \(USD per million tokens\) in ~\/\.jevis\/config.json to see dollars\./);
  assert.ok(!formatted.includes("$"));
  assert.equal(formatted.split("\n").filter((line) => /^2026-/.test(line)).length, 5);
  assert.match(formatted, /Tokens per call: prompt 50 in \/ 5 out/);
  assert.match(formatted, /^30d at last 24h +30 /m);
  assert.match(formatted, /^2026-10-06 +1\* /m, "a day with only logged calls is marked");
  assert.match(formatted, /call record was off/);
}));

test("cost: dollars use only explicit prices, allow zero, and never estimate unrecorded tokens", () => {
  withPrices("2", "10", () => {
    const result = cost({ home, since, now });
    assert.equal(result.totals.dollars, 0.0063);
    assert.equal(result.projection.dollars, 0.054);
    assert.equal(result.days.at(-1).dollars, 0);
    assert.match(formatCost(result), /^total .*\$0\.01$/m);
    assert.doesNotMatch(formatCost(result), /Set JEVIS_PRICE/);
  });
  for (const [input, output] of [["2", undefined], ["", "10"], ["-1", "10"], ["NaN", "10"], ["2", "Infinity"]]) {
    withPrices(input, output, () => assert.equal(cost({ home, since, now }).totals.dollars, null));
  }
  withPrices("0", "0", () => assert.equal(cost({ home, since, now }).totals.dollars, 0));
});

test("cost: missing files and fewer than three active days work without writes", () => withPrices(undefined, undefined, () => {
  const empty = cost({ home: join(home, "missing"), since });
  assert.equal(empty.totals.calls, 0);
  assert.deepEqual(empty.days, []);
  assert.equal(empty.projection.calls, 0);
  assert.equal(empty.averages.review.input_tokens, 0);
  assert.match(formatCost(empty), /^total +0 /m);
  const quiet = cost({ home, since, now: Date.parse("2026-12-01T00:00:00Z") });
  assert.equal(quiet.projection.calls, 0, "nothing in the last 24 hours projects nothing");
}));

test("cost CLI: config prices are applied, environment wins, JSON matches the report, default window is 30d", () => {
  const config = join(home, "config.json");
  writeFileSync(config, JSON.stringify({ JEVIS_PRICE_IN: 2, JEVIS_PRICE_OUT: "10" }));
  assert.deepEqual(readConfig(config).errors, []);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("JEVIS_")));
  env.JEVIS_HOME = home;
  const cli = fileURLToPath(new URL("../bin/jevis.mjs", import.meta.url));
  const run = (args, overrides = {}) => execFileSync(process.execPath, [cli, "cost", ...args], { env: { ...env, ...overrides }, encoding: "utf8" });
  const result = JSON.parse(run(["--since", "2026-10-01", "--json"]));
  assert.equal(result.totals.dollars, 0.0063);
  assert.equal(result.note, null);
  assert.equal(run(["--since", "2026-10-01"]), `${formatCost(result)}\n`);
  assert.equal(JSON.parse(run(["--since", "2026-10-01", "--json"], { JEVIS_PRICE_IN: "0" })).totals.dollars, 0.0021);
  const before = Date.now() - 30 * 86_400_000;
  const defaultSince = Date.parse(JSON.parse(run(["--json"])).since);
  assert.ok(defaultSince >= before && defaultSince <= Date.now() - 30 * 86_400_000);
  writeFileSync(config, JSON.stringify({ JEVIS_PRICE_IN: -1, JEVIS_PRICE_OUT: "Infinity" }));
  assert.equal(readConfig(config).errors.length, 2);
  assert.match(run(["--since", "7d"]), /Set JEVIS_PRICE_IN and JEVIS_PRICE_OUT/);
});
