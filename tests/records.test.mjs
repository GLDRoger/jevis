import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";

// A private home and wiki, and a call record made the way hooks make it: evaluate() with a scripted Jev.
process.env.JEVIS_HOME = mkdtempSync(join(tmpdir(), "jevis-records-"));
const wikiDir = mkdtempSync(join(tmpdir(), "jevis-records-wiki-"));
process.env.JEVIS_WIKI = wikiDir;
for (const k of ["JEVIS_RECORD", "JEVIS_ENABLE", "JEVIS_MODE"]) delete process.env[k];
const { setJevTransport } = await import("../src/jev.mjs");
const { evaluate } = await import("../src/engine.mjs");
const { loadWiki } = await import("../src/wiki.mjs");
const { log } = await import("../src/state.mjs");
const { tune, formatTune, sinceTime } = await import("../src/tune.mjs");
const { exportDataset, formatExport, goldOf, pickTest } = await import("../src/export.mjs");

const put = (id, text) => {
  mkdirSync(join(wikiDir, id, ".."), { recursive: true });
  writeFileSync(join(wikiDir, `${id}.md`), text);
};
const PAGE = (ask) => `---\nevent: prompt\nask: ${ask}\naction: context\ntitle: Pages\nsource: test\nmin: 0.75\n---\nBody.\n`;
put("t/page", PAGE("Does `request` ask for a page?"));
put("t/push", "---\nevent: tool\ntools: [Bash]\nask: Does `input` force push?\nunless: Did `request` ask to force push?\naction: deny\ntitle: Force push\nsource: test\nmin: 0.8\nwhen: { marks.plain_read: false }\n---\nBody.\n");

setJevTransport(async ({ state, questions }) => {
  const text = `${state.request ?? ""} ${state.input ?? ""}`;
  const p = {
    "axis.correction": /wrong/.test(text) ? 0.9 : 0.1,
    "t/page": /pagey/.test(text) ? 0.7 : /page/.test(text) ? 0.9 : 0.1,
    "t/push": /push/.test(state.input ?? "") ? 0.95 : 0.05,
    "t/push#unless": /push it/.test(state.request) ? 0.9 : 0.1,
  };
  return { answers: Object.fromEntries(Object.keys(questions).map((k) => [k, { type: "noul", noul: p[k] ?? 0.05 }])) };
});
const tick = () => new Promise((r) => setTimeout(r, 5));
const prompt = async (sessionId, request, origin = "person") => {
  await evaluate({ event: "prompt", sessionId, harness: "Claude Code", model: "claude-opus-5-5", wiki: loadWiki(), state: { request, previous_request: null, attachments: [], workspace: {}, agent: { harness: "Claude Code", model: "claude-opus-5-5", origin } } });
  await tick();
};
const stop = async (sessionId, request, final) => {
  await evaluate({ event: "stop", sessionId, harness: "Claude Code", wiki: loadWiki(), state: { request, final_message: final, evidence: {} } });
  await tick();
};
const tool = async (sessionId, request, input) => {
  await evaluate({ event: "tool", tool: "Bash", sessionId, harness: "Codex", model: "gpt-6", wiki: loadWiki(), state: { request, tool: "Bash", input, workspace: {} } });
  await tick();
};

test("export: only Jev and historical labels enter Laya training, not Luna", () => {
  const home = mkdtempSync(join(tmpdir(), "jevis-export-deciders-"));
  mkdirSync(join(home, "jev", "questions"), { recursive: true });
  writeFileSync(join(home, "jev", "questions", "v1.json"), JSON.stringify({ q: { type: "noul", instructions: "A question?" } }));
  const rows = [undefined, "jev", "luna", "other"].map((decider, i) => ({ decider, event: "tool", version: "v1", sessionId: `s${i}`, state: { request: `${i}` }, answers: { q: 0.9 } }));
  writeFileSync(join(home, "jev", "calls.jsonl"), rows.map(JSON.stringify).join("\n") + "\n");
  const r = exportDataset({ home, out: join(home, "out"), testShare: 0 });
  assert.equal(r.train, 2);
  assert.equal(r.otherDeciders, 2);
  assert.equal(r.sessions, 2);
  assert.match(formatExport(r), /Skipped 2 non-Jev calls \(including Luna\): Laya training exports keep only Jev labels/);
  const exported = gunzipSync(readFileSync(r.files.train)).toString().trim().split("\n").map(JSON.parse);
  assert.deepEqual(exported.map((row) => JSON.parse(row.state).request).sort(), ["0", "1"]);
});

await prompt("s1", "make a page for the bakery");
log({ event: "prompt", sessionId: "s1", acted: ["t/page"] });
await tick();
await stop("s1", "make a page for the bakery", "Here is the page, with a gradient hero.");
await prompt("s1", "that's wrong, the header is missing");
await prompt("s1", "a pagey thing");
await prompt("s3", "wrong again, redo it", "agent");
await tool("s2", "fix the bug", "git push -f origin main");
await tool("s2", "push it", "git push -f origin main");
await tool("s2", "push it", "git push -f origin main");
await tool("s2", "fix the bug", "ls -la");

test("stats --near: each entry's fires, near misses, and stand-downs under today's rules", () => {
  const { records, entries } = tune(loadWiki().entries);
  const by = Object.fromEntries(entries.map((e) => [e.id, e]));
  assert.equal(records, 10, "4 prompts and 3 two-phase tool evaluations: plain reads and stops do not count");
  assert.deepEqual({ asked: by["t/page"].asked, fires: by["t/page"].fires, near: by["t/page"].near, max: by["t/page"].max }, { asked: 4, fires: 1, near: 1, max: 0.9 });
  assert.deepEqual({ asked: by["t/push"].asked, fires: by["t/push"].fires, stoodDown: by["t/push"].stoodDown, stale: by["t/push"].stale }, { asked: 0, fires: 0, stoodDown: 0, stale: 3 }, "split exception records are safely excluded, not joined for calibration");
  // Historical co-located answers must still calibrate fires and stand-downs.
  const legacy = mkdtempSync(join(tmpdir(), "jevis-legacy-tune-"));
  const e = loadWiki().entries.find((e) => e.id === "t/push");
  writeFileSync(join(legacy, "v1.json"), JSON.stringify({ [e.id]: { type: "noul", instructions: e.ask }, [`${e.id}#unless`]: { type: "noul", instructions: e.unless } }));
  const legacyFile = join(legacy, "calls.jsonl");
  writeFileSync(legacyFile, [0.1, 0.9, 0.9].map((u) => JSON.stringify({ event: "tool", version: "v1", state: { tool: "Bash", input: "git push -f origin main" }, answers: { [e.id]: 0.95, [`${e.id}#unless`]: u } })).join("\n") + "\n");
  const historical = tune([e], { file: legacyFile, questionsDir: legacy });
  const row = historical.entries[0];
  assert.deepEqual({ asked: row.asked, fires: row.fires, stoodDown: row.stoodDown }, { asked: 3, fires: 1, stoodDown: 2 }, "the user's own request stood the deny down twice");
  assert.match(formatTune(historical), /t\/push\s+3\s+1\s+0\s+2\s+0\.95/);

  put("t/page", PAGE("Does `request` ask for a web page?"));
  const reworded = tune(loadWiki().entries).entries.find((e) => e.id === "t/page");
  assert.deepEqual({ asked: reworded.asked, stale: reworded.stale }, { asked: 0, stale: 4 }, "answers to the old wording no longer count");
  put("t/page", PAGE("Does `request` ask for a page?"));
  assert.equal(tune(loadWiki().entries, { since: Date.now() + 60_000 }).records, 0);
  assert.equal(sinceTime("2d", Date.parse("2026-09-29T00:00:00Z")), Date.parse("2026-09-27T00:00:00Z"));
  assert.throws(() => sinceTime("last week"), /--since takes/);
});

test("stats --near: judged as the engine would today, not as the record says", () => {
  // One hand-written record: an old classifier's marks, a reworded unless, and an optional entry.
  const home = mkdtempSync(join(tmpdir(), "jevis-records-raw-"));
  const qdir = join(home, "questions");
  mkdirSync(qdir);
  const entry = (id, extra = {}) => ({ id, event: "tool", action: "deny", min: 0.8, unless_max: 0.5, ask: `Does \`input\` do ${id}?`, when: { "marks.plain_read": false }, tools: ["Bash"], ...extra });
  const gated = entry("t/gated");
  const reworded = entry("t/reworded", { unless: "Did `request` ask for it, in so many words?" });
  const optional = entry("t/optional", { optional: true });
  const plain = entry("t/plain", { when: undefined });
  const q = (e) => ({ type: "noul", instructions: e.ask });
  writeFileSync(join(qdir, "v1.json"), JSON.stringify({ "t/gated": q(gated), "t/reworded": q(reworded), "t/reworded#unless": { type: "noul", instructions: "Did `request` ask for it?" }, "t/optional": q(optional), "t/plain": q(plain) }));
  const record = (input) => JSON.stringify({ at: "2026-09-29T10:00:00Z", event: "tool", version: "v1", sessionId: "r", state: { request: "x", tool: "Bash", input, marks: { plain_read: false, ran_before: false } }, answers: { "t/gated": 0.9, "t/reworded": 0.9, "t/reworded#unless": 0.1, "t/optional": 0.9, "t/plain": 0.9 } });
  writeFileSync(join(home, "calls.jsonl"), `${record("ls -la")}\n${record("git push -f")}\n`);
  const r = tune([gated, reworded, optional, plain], { file: join(home, "calls.jsonl"), questionsDir: qdir });
  const by = Object.fromEntries(r.entries.map((e) => [e.id, e]));
  assert.equal(by["t/gated"].asked, 1, "today's classifier calls ls a plain read, whatever the record's marks say");
  assert.equal(by["t/plain"].asked, 2);
  assert.deepEqual({ asked: by["t/reworded"].asked, stale: by["t/reworded"].stale }, { asked: 0, stale: 1 }, "a reworded unless makes the answer stale, not a stand-down");
  assert.equal(by["t/optional"], undefined, "an optional entry that is off cannot fire");
  assert.deepEqual(r.off, ["t/optional"]);
});

test("export: rows in Laya's format, split by whole sessions, repeats dropped, files private", () => {
  assert.deepEqual(goldOf(0.9), { label: "true", probabilities: { true: 0.9, false: 0.1 }, noul: 0.9 });
  assert.equal(goldOf({ type: "choice", choice: "a" }), null);
  assert.deepEqual([...pickTest(new Map([["big", 90], ["a", 5], ["b", 5]]), 0.1)].sort().length > 0, true);
  assert.ok(!pickTest(new Map([["big", 90], ["a", 5], ["b", 5]]), 0.1).has("big"), "a session too big for the test share stays in train");

  const out = join(mkdtempSync(join(tmpdir(), "jevis-export-")), "ds");
  const r = exportDataset({ out, testShare: 0.5 });
  assert.equal(r.duplicates, 2, "both phases of the repeated push evaluation are deduplicated");
  assert.equal(r.train + r.test, 9, "4 prompts, 1 stop, and 2 distinct two-phase tool evaluations");
  assert.ok(r.train > 0 && r.test > 0);
  const rows = (split) => gunzipSync(readFileSync(r.files[split])).toString().trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const bySession = {};
  const toolQuestions = [];
  for (const split of ["train", "test"]) {
    if (process.platform !== "win32") assert.equal(statSync(r.files[split]).mode & 0o777, 0o600);
    for (const row of rows(split)) {
      assert.deepEqual(Object.keys(row).sort(), ["gold", "id", "questions", "state", "workflow"]);
      const q = JSON.parse(row.questions);
      const g = JSON.parse(row.gold);
      if (row.workflow === "jevis/tool") toolQuestions.push(Object.keys(q).sort());
      assert.deepEqual(Object.keys(q).sort(), Object.keys(g).sort());
      assert.ok(Object.values(q).every((x) => x.type === "noul" && x.instructions));
      const state = JSON.parse(row.state);
      const s = state.agent?.origin === "agent" ? "s3" : state.tool ? "s2" : "s1";
      (bySession[s] ??= new Set()).add(split);
    }
  }
  assert.equal(toolQuestions.filter((keys) => keys.includes("t/push") && !keys.includes("t/push#unless")).length, 2);
  assert.equal(toolQuestions.filter((keys) => keys.length === 1 && keys[0] === "t/push#unless").length, 2);
  for (const [s, splits] of Object.entries(bySession)) assert.equal(splits.size, 1, `${s} is wholly in one split`);
  assert.equal(exportDataset({ out, events: ["tool"], testShare: 0 }).test, 0);

  // A record written before a masking rule existed is masked on the way out.
  const calls = join(process.env.JEVIS_HOME, "jev", "calls.jsonl");
  const version = JSON.parse(readFileSync(calls, "utf8").split("\n")[0]).version;
  appendFileSync(calls, `${JSON.stringify({ at: new Date().toISOString(), event: "tool", version, sessionId: "old", state: { request: "x", tool: "Bash", input: 'aws configure set aws_secret_access_key "private phrase for test"' }, answers: { "t/push": 0.1 } })}\n`);
  const again = exportDataset({ out, testShare: 0 });
  assert.ok(!gunzipSync(readFileSync(again.files.train)).toString().includes("private phrase for test"));
});

test("tune: thresholds are judged only on the active decider's records", async () => {
  const { tune } = await import("../src/tune.mjs");
  const { mkdtempSync, writeFileSync, mkdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "jevis-tune-decider-"));
  mkdirSync(join(dir, "questions"));
  const entry = { id: "probe", event: "prompt", action: "note", min: 0.5, ask: "Is it a probe?" };
  const rows = [{ event: "prompt", version: "v", answers: { probe: 0.9 }, state: {} }, { event: "prompt", version: "v", decider: "jev", answers: { probe: 0.9 }, state: {} }, { event: "prompt", version: "v", decider: "luna", answers: { probe: 0.9 }, state: {} }];
  writeFileSync(join(dir, "calls.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const saved = process.env.JEVIS_DECIDER;
  try {
    delete process.env.JEVIS_DECIDER;
    assert.equal(tune([entry], { file: join(dir, "calls.jsonl"), questionsDir: join(dir, "questions") }).records, 2);
    process.env.JEVIS_DECIDER = "luna";
    const r = tune([entry], { file: join(dir, "calls.jsonl"), questionsDir: join(dir, "questions") });
    assert.equal(r.records, 1);
    assert.equal(r.decider, "luna");
  } finally {
    if (saved === undefined) delete process.env.JEVIS_DECIDER; else process.env.JEVIS_DECIDER = saved;
  }
});
