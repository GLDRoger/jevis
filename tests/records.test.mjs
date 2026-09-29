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
const { mine, formatMine } = await import("../src/mine.mjs");
const { exportDataset, goldOf, pickTest } = await import("../src/export.mjs");

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
  assert.equal(records, 7, "4 prompts and 3 tool calls: the plain read asked nothing, and no entry is about stops");
  assert.deepEqual({ asked: by["t/page"].asked, fires: by["t/page"].fires, near: by["t/page"].near, max: by["t/page"].max }, { asked: 4, fires: 1, near: 1, max: 0.9 });
  assert.deepEqual({ asked: by["t/push"].asked, fires: by["t/push"].fires, stoodDown: by["t/push"].stoodDown }, { asked: 3, fires: 1, stoodDown: 2 }, "the user's own request stood the deny down twice");
  assert.match(formatTune({ records, entries }), /t\/push\s+3\s+1\s+0\s+2\s+0\.95/);

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

test("mine: a person's correction, with the request and answer it corrects and what Jevis did that turn", () => {
  const r = mine();
  assert.equal(r.source, "calls");
  assert.equal(r.corrections.length, 1, "an agent's correction is left out, and a session's first prompt has nothing to correct");
  const c = r.corrections[0];
  assert.equal(c.before, "make a page for the bakery");
  assert.equal(c.final, "Here is the page, with a gradient hero.");
  assert.equal(c.request, "that's wrong, the header is missing");
  assert.deepEqual(c.jevis, ["noted t/page"]);
  const md = formatMine(r);
  assert.match(md, /\*\*Then:\*\* that's wrong, the header is missing/);
  assert.match(md, /skills\/jevis\/SKILL\.md/);
  assert.equal(mine({ agents: true }).corrections.length, 1, "s3's only prompt still has no earlier turn to correct");
  assert.equal(mine({ min: 0.95 }).corrections.length, 0);

  // With JEVIS_RECORD=off there is no call record: the decision log's excerpts stand in.
  const home = mkdtempSync(join(tmpdir(), "jevis-records-log-"));
  const row = (at, r) => JSON.stringify({ at: `2026-09-29T10:0${at}:00.000Z`, sessionId: "L", ...r });
  writeFileSync(join(home, "log.jsonl"), [row(1, { event: "prompt", request: "make a chart", profile: { correction: 0.1 } }), row(2, { event: "stop", final: "Done: chart.png" }), row(3, { event: "prompt", request: "no, the axis is wrong", profile: { correction: 0.8 } })].join("\n") + "\n");
  const fallback = mine({ home });
  assert.equal(fallback.source, "log");
  assert.deepEqual(fallback.corrections.map((x) => [x.before, x.final, x.request]), [["make a chart", "Done: chart.png", "no, the axis is wrong"]]);
  assert.match(formatMine(fallback), /cut to 200 characters/);
  // A correction just after --since still gets the request and answer just before it.
  assert.equal(mine({ home, since: Date.parse("2026-09-29T10:02:30.000Z") }).corrections[0].before, "make a chart");
  assert.equal(mine({ since: Date.now() + 1000 }).corrections.length, 0);
});

test("export: rows in Laya's format, split by whole sessions, repeats dropped, files private", () => {
  assert.deepEqual(goldOf(0.9), { label: "true", probabilities: { true: 0.9, false: 0.1 }, noul: 0.9 });
  assert.equal(goldOf({ type: "choice", choice: "a" }), null);
  assert.deepEqual([...pickTest(new Map([["big", 90], ["a", 5], ["b", 5]]), 0.1)].sort().length > 0, true);
  assert.ok(!pickTest(new Map([["big", 90], ["a", 5], ["b", 5]]), 0.1).has("big"), "a session too big for the test share stays in train");

  const out = join(mkdtempSync(join(tmpdir(), "jevis-export-")), "ds");
  const r = exportDataset({ out, testShare: 0.5 });
  assert.equal(r.duplicates, 1, "the repeated push call is one row");
  assert.equal(r.train + r.test, 7, "4 prompts, 1 stop, and 2 distinct tool calls");
  assert.ok(r.train > 0 && r.test > 0);
  const rows = (split) => gunzipSync(readFileSync(r.files[split])).toString().trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const bySession = {};
  for (const split of ["train", "test"]) {
    if (process.platform !== "win32") assert.equal(statSync(r.files[split]).mode & 0o777, 0o600);
    for (const row of rows(split)) {
      assert.deepEqual(Object.keys(row).sort(), ["gold", "id", "questions", "state", "workflow"]);
      const q = JSON.parse(row.questions);
      const g = JSON.parse(row.gold);
      assert.deepEqual(Object.keys(q).sort(), Object.keys(g).sort());
      assert.ok(Object.values(q).every((x) => x.type === "noul" && x.instructions));
      const state = JSON.parse(row.state);
      const s = state.agent?.origin === "agent" ? "s3" : state.tool ? "s2" : "s1";
      (bySession[s] ??= new Set()).add(split);
    }
  }
  for (const [s, splits] of Object.entries(bySession)) assert.equal(splits.size, 1, `${s} is wholly in one split`);
  assert.equal(exportDataset({ out, events: ["tool"], testShare: 0 }).test, 0);

  // A record written before a masking rule existed is masked on the way out.
  const calls = join(process.env.JEVIS_HOME, "jev", "calls.jsonl");
  const version = JSON.parse(readFileSync(calls, "utf8").split("\n")[0]).version;
  appendFileSync(calls, `${JSON.stringify({ at: new Date().toISOString(), event: "tool", version, sessionId: "old", state: { request: "x", tool: "Bash", input: 'aws configure set aws_secret_access_key "private phrase for test"' }, answers: { "t/push": 0.1 } })}\n`);
  const again = exportDataset({ out, testShare: 0 });
  assert.ok(!gunzipSync(readFileSync(again.files.train)).toString().includes("private phrase for test"));
});
