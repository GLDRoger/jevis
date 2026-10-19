import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";

process.env.JEVIS_HOME = mkdtempSync(join(tmpdir(), "jevis-rules-"));
delete process.env.JEVIS_JEV;
const { codeDecision, RULES: ALL_RULES } = await import("../src/rules.mjs");
const { evaluate, question, unlessKey } = await import("../src/engine.mjs");
const { HEDGES, setJevTransport } = await import("../src/jev.mjs");
const { tune } = await import("../src/tune.mjs");
const { exportDataset } = await import("../src/export.mjs");
const { inputMarks, toolInput } = await import("../src/context.mjs");
const { loadWiki, validateEntry, WIKI_ROOT } = await import("../src/wiki.mjs");

const write = (content, path = "index.html", request = "build the page") => ({ tool: "Write", input: toolInput("Write", { file_path: path, content }), request });

const wiki = loadWiki([WIKI_ROOT]);
const entry = (id) => ({ id, event: "tool", action: "context", min: 0.85, unless_max: 0.5,
  ask: "Does `input` need a context note?", unless: "Does `request` make the note unnecessary?",
  title: "Fixture", body: "Check this.", when: {}, decide: "claim_contradicted" });
const exact = { final_message: "Tests pass.", evidence: { checks_after_last_edit: [{ command: "npm test", success: false }] } };
const run = (state, entries, opts = {}) => evaluate({ event: "tool", state, tool: state.tool, wiki: { entries }, record: false, ...opts });
let calls = [];
const transport = (exception = 0.1) => setJevTransport(async (body) => {
  calls.push(body);
  return { answers: Object.fromEntries(Object.keys(body.questions).map((key) => [key, { noul: key.endsWith("#unless") ? exception : 0.1 }])) };
});

test("engine code: false rules don't ask Jev, even with axes enabled", async () => {
  calls = []; transport();
  const r = await run(write("<p>Clay classes</p>"), [entry("fixture/check"), entry("fixture/other")]);
  assert.equal(r.jevQuestions, 0);
  assert.equal(calls.length, 0);
  assert.deepEqual(r.code, { "fixture/check": false, "fixture/other": false });
});
test("engine: prompt/stop profiles still reach Jev without wiki candidates", async () => {
  calls = []; transport();
  for (const event of ["prompt", "stop"]) {
    const r = await evaluate({ event, state: {}, wiki: { entries: [] }, record: false });
    assert.ok(r.jevQuestions > 0);
    assert.ok(Object.keys(r.profile).length > 0);
  }
  assert.equal(calls.length, 2);
});
test("engine code: positive context rule with no exception or axis gate needs no Jev", async () => {
  calls = []; transport();
  const e = { ...entry("fixture/claim"), action: "context", unless: undefined };
  const r = await run({ ...write("<p>Clay — classes</p>"), ...exact }, [e]);
  assert.equal(calls.length, 0);
  assert.equal(r.jevQuestions, 0);
  assert.equal(r.fired.length, 1);
});
test("engine code: an axis gate still needs its model answer", async () => {
  calls = []; transport();
  const e = { ...entry("fixture/claim"), action: "context", unless: undefined, when: { destructive: ">=0.8" } };
  const r = await run({ ...write("<p>Clay — classes</p>"), ...exact }, [e]);
  assert.deepEqual(Object.keys(calls[0].questions), ["axis.destructive"]);
  assert.equal(r.fired.length, 0);
});
test("engine code: exact positive asks only its exception, which can stand it down", async () => {
  for (const exception of [0.1, 0.9]) {
    calls = []; transport(exception);
    const r = await run({ ...write("<p>Clay — classes</p>"), ...exact }, [entry("fixture/claim")], { axes: false });
    assert.equal(calls.length, 1);
    assert.equal(r.scores["fixture/claim"], 1);
    assert.deepEqual(Object.keys(calls[0].questions), [unlessKey("fixture/claim")]);
    assert.equal(r.fired.length, exception < 0.5 ? 1 : 0);
  }
});

test("hedging: only one tail request at 1000 ms", () => {
  assert.deepEqual(HEDGES, [1000]);
});


test("Bash writes_file: unparsed commands with a proven write still count as writes", () => {
  const marks = (input) => inputMarks(input, { tool: "Bash" }).writes_file;
  for (const input of [
    "cat > a.html <<EOF\n<h1>$TITLE</h1>\nEOF",
    "cat <<EOF > a.html\nx\nEOF",
    "cd /x && python3 - <<'EOF'\np='a.tsx'; s=open(p).read()\nopen(p, 'w').write(s.replace('a', 'b'))\nEOF",
    "python3 - <<'PY'\nfrom pathlib import Path\nPath('a.css').write_text('x')\nPY",
    "node - <<'EOF'\nrequire('fs').writeFileSync('a.html', '<b>x</b>')\nEOF",
  ]) assert.equal(marks(input), true, input);
  for (const input of [
    "cd x && git log --oneline | head -5 2>/dev/null",
    "python3 - <<'EOF'\nprint(open('a.txt').read())\nEOF",
    "cat <<EOF | wc -l\n<div><p>x</p></div>\nEOF",
    "npm test 2>&1 | tail -5",
    "npx eslint src $(cat list) > /tmp/eslint.log 2>&1",
    "python3 - <<'PY'\nimport sys; sys.stdout.write(open('data.json').read())\nPY",
    "python3 - <<'PY'\nopen('/tmp/out.json', 'w').write('{}')\nPY",
  ]) assert.notEqual(marks(input), true, input);
});

test("engine model: only qualifying main answers get a second, exception-only call", async () => {
  const e = { ...entry("fixture/check"), decide: undefined };
  const state = write("<h1>Hi</h1>");
  for (const score of [0.1, e.min, 0.95]) {
    calls = [];
    setJevTransport(async (body) => {
      calls.push(body);
      return { answers: Object.fromEntries(Object.keys(body.questions).map((key) => [key, { noul: key === e.id ? score : 0.1 }])) };
    });
    const r = await run(state, [e]);
    assert.ok(e.id in calls[0].questions);
    assert.ok(!(unlessKey(e.id) in calls[0].questions));
    assert.equal(calls.length, score >= e.min ? 2 : 1);
    assert.equal(r.fired.length, score >= e.min ? 1 : 0);
    assert.equal(r.jevQuestions, calls.reduce((n, body) => n + Object.keys(body.questions).length, 0));
    if (score >= e.min) {
      assert.deepEqual(Object.keys(calls[1].questions), [unlessKey(e.id)]);
      assert.deepEqual(calls[1].state, calls[0].state);
    }
  }
});

test("engine model: a failed when gate avoids the exception call", async () => {
  const e = { ...entry("fixture/check"), decide: undefined, when: { destructive: ">=0.8" } };
  calls = [];
  setJevTransport(async (body) => {
    calls.push(body);
    return { answers: Object.fromEntries(Object.keys(body.questions).map((key) => [key, { noul: key === e.id ? 0.95 : 0.1 }])) };
  });
  const r = await run(write("<h1>Hi</h1>"), [e]);
  assert.equal(calls.length, 1);
  assert.equal(r.fired.length, 0);
});

test("engine model: failed, timed-out or missing exceptions fail open without losing other fires", async () => {
  const e = { ...entry("fixture/check"), decide: undefined };
  const other = { ...e, id: "test/no-exception", unless: undefined, action: "context" };
  for (const failure of [new Error("server unavailable"), Object.assign(new Error("slow"), { name: "TimeoutError" }), null]) {
    calls = [];
    setJevTransport(async (body) => {
      calls.push(body);
      if (calls.length === 2) {
        if (failure) throw failure;
        return { answers: {} };
      }
      return { answers: Object.fromEntries(Object.keys(body.questions).map((key) => [key, { noul: 0.95 }])) };
    });
    const r = await run(write("<h1>Hi</h1>"), [e, other], { axes: false });
    assert.equal(calls.length, 2);
    assert.deepEqual(r.fired.map((e) => e.id), [other.id]);
    assert.equal(r.error, undefined);
    assert.equal(r.jevQuestions, 3);
  }
});

test("engine model: both phases share the timeout budget and total timing", async () => {
  const e = { ...entry("fixture/check"), decide: undefined };
  const budgets = [];
  setJevTransport(async (body, timeoutMs) => {
    budgets.push(timeoutMs);
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { answers: Object.fromEntries(Object.keys(body.questions).map((key) => [key, { noul: key === e.id ? 0.95 : 0.1 }])) };
  });
  const r = await run(write("<h1>Hi</h1>"), [e], { axes: false, timeoutMs: 500 });
  assert.equal(budgets.length, 2);
  assert.ok(budgets[1] >= 1 && budgets[1] <= budgets[0] - 15, JSON.stringify(budgets));
  assert.ok(r.ms >= 30, `total timing: ${r.ms}`);
  assert.equal(r.fired.length, 1);
});
test("wiki decide: only the supported code rule is valid", () => {
  assert.deepEqual(wiki.broken, []);
  const e = { ...entry("fixture/check"), event: "stop", action: "block" };
  assert.deepEqual(validateEntry({ ...e, source: "test" }), []);
  assert.ok(validateEntry({ ...e, source: "test", decide: "user_javascript" }).some((s) => /decide/.test(s)));
  assert.deepEqual(ALL_RULES, ["claim_contradicted"]);
});

test("claim_contradicted: a pass claim against a failed latest check, decided by code alone", async () => {
  const stop = (final_message, checks) => ({ final_message, evidence: { edited: true, checks_after_last_edit: checks } });
  const failed = [{ command: "npm test", success: false, exit_code: 1 }];
  const fixed = [{ command: "npm test", success: false, exit_code: 1 }, { command: "npm test", success: true, exit_code: 0 }];
  const mixed = [{ command: "npm test", success: true, exit_code: 0 }, { command: "npm run lint", success: false, exit_code: 2 }];
  const unknown = [{ command: "npm test", success: null, exit_code: null }];
  assert.equal(codeDecision("claim_contradicted", stop("Done. All tests pass.", failed)), true);
  assert.equal(codeDecision("claim_contradicted", stop("Fixed it.\nThe build is green and lint is clean.", mixed)), true);
  assert.equal(codeDecision("claim_contradicted", stop("Done. All tests pass.", fixed)), false, "a later passing run of the same check wins");
  assert.equal(codeDecision("claim_contradicted", stop("Done. All tests pass.", unknown)), false, "no recorded result proves nothing");
  assert.equal(codeDecision("claim_contradicted", stop("Done. All tests pass.", [])), false);
  for (const msg of ["2 tests fail; the rest pass.", "Tests did not pass yet.", "Unit tests pass but lint fails.", "The build isn't green.", "> CI passed, they said", "Done. Rewrote the button."]) {
    assert.equal(codeDecision("claim_contradicted", stop(msg, failed)), false, msg);
  }
  const entry = (await import("../src/wiki.mjs")).loadWiki().entries.find((e) => e.id === "verification/claim-contradicted");
  assert.ok(entry, "shipped as a stop lesson");
  let sent = 0;
  setJevTransport(async () => { sent += 1; return { answers: {} }; });
  try {
    const r = await evaluate({ event: "stop", state: { request: "fix it", ...stop("All tests pass.", failed) }, wiki: { entries: [entry] }, codeOnly: true, axes: false });
    assert.deepEqual(r.fired.map((e) => e.id), [entry.id]);
    const quiet = await evaluate({ event: "stop", state: { request: "fix it", ...stop("All tests pass.", fixed) }, wiki: { entries: [entry] }, codeOnly: true, axes: false });
    assert.equal(quiet.fired.length, 0);
    assert.equal(sent, 0, "never asks the decision model");
  } finally {
    setJevTransport(null);
  }
});

test("engine: a code-decided stop check still acts when the review's axes call fails", async () => {
  const claim = loadWiki().entries.find((e) => e.id === "verification/claim-contradicted");
  const failed = { request: "fix it", final_message: "All tests pass.", evidence: { edited: true, checks_after_last_edit: [{ command: "npm test", success: false, exit_code: 1 }] } };
  setJevTransport(async () => { throw new Error("jev unavailable"); });
  try {
    const r = await evaluate({ event: "stop", state: failed, wiki: { entries: [claim] }, codeOnly: true, axes: true, record: false });
    assert.ok(r.error, "the failure is still reported");
    assert.deepEqual(r.profile, {}, "no axes without answers, so no review");
    assert.deepEqual(r.fired.map((e) => e.id), [claim.id]);
    const model = { ...entry("fixture/model"), decide: undefined };
    const t = await run(write("<p>Clay classes</p>"), [model]);
    assert.ok(t.error);
    assert.equal(t.fired.length, 0, "a lesson that needed the model stands down");
  } finally {
    setJevTransport(null);
  }
});

test("records: exact code scores never enter model answers or exported labels", async () => {
  calls = []; transport();
  const e = entry("fixture/claim");
  await run({ tool: "Write", input: "fixture", ...exact }, [e], { record: true, axes: false });
  const record = JSON.parse(readFileSync(join(process.env.JEVIS_HOME, "jev", "calls.jsonl"), "utf8").trim().split("\n").at(-1));
  assert.equal(record.answers[e.id], undefined);
  assert.equal(record.answers[unlessKey(e.id)], 0.1);
  const questions = JSON.parse(readFileSync(join(process.env.JEVIS_HOME, "jev", "questions", `${record.version}.json`), "utf8"));
  assert.deepEqual(Object.keys(questions), [unlessKey(e.id)]);
  const exported = exportDataset({ out: join(process.env.JEVIS_HOME, "export"), testShare: 0 });
  const rows = gunzipSync(readFileSync(exported.files.train)).toString().trim().split("\n").map(JSON.parse);
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(JSON.parse(rows[0].gold)), [unlessKey(e.id)]);
  assert.deepEqual(Object.keys(JSON.parse(rows[0].questions)), [unlessKey(e.id)]);
});

test("stats: historical probabilities are excluded for exact code decisions", () => {
  const dir = mkdtempSync(join(tmpdir(), "jevis-rules-stats-"));
  const qdir = join(dir, "questions");
  mkdirSync(qdir);
  const e = entry("fixture/claim");
  writeFileSync(join(qdir, "old.json"), JSON.stringify({ [e.id]: question(e), [unlessKey(e.id)]: { type: "noul", instructions: e.unless } }));
  const file = join(dir, "calls.jsonl");
  const states = [{ tool: "Write", input: "fixture", ...exact }, { tool: "Write", input: "fixture", final_message: "Updated the file." }];
  const rows = states.map((state) => ({ event: "tool", at: new Date().toISOString(), version: "old", state, answers: { [e.id]: 0.95, [unlessKey(e.id)]: 0.1 } }));
  writeFileSync(file, rows.map(JSON.stringify).join("\n") + "\n");
  const row = tune([e], { file, questionsDir: qdir }).entries[0];
  assert.equal(row.asked, 0, "both positive and negative code decisions exclude historical probabilities");
  assert.equal(row.fires, 0);
  const model = tune([{ ...e, decide: undefined }], { file, questionsDir: qdir }).entries[0];
  assert.equal(model.asked, 2, "same historical records remain usable for model-decided context notes");
  assert.equal(model.fires, 2);
});
