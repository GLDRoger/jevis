import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { mergeToolResults, turnEvidence, withTouched } from "../src/context.mjs";
import { onPost, onPrompt, onStop, onTool } from "../src/hooks.mjs";
import { setJevTransport } from "../src/jev.mjs";
import { RESULT_CLIP, RESULT_MEMORY, toolResult } from "../src/post.mjs";
import { loadSession } from "../src/state.mjs";
import { readClaudeTranscript, readRollout } from "../src/transcript.mjs";

process.env.JEVIS_HOME = mkdtempSync(join(tmpdir(), "jevis-post-"));
for (const key of ["JEVIS_MODE", "JEVIS_SCOPE", "JEVIS_DISABLE", "JEVIS_JEV", "JEVIS_WIKI"]) delete process.env[key];
process.env.JEVIS_CRITIC = "off";
const base = { session_id: "post", hook_event_name: "PostToolUse", tool_use_id: "t", tool_name: "Bash", tool_input: { command: "npm test" } };
const claude = { permission_mode: "default", transcript_path: "/w/.claude/projects/p/session.jsonl" };
const codex = { model: "gpt-6.1-sol", turn_id: "turn-1" };
const muse = { model: "muse-wonder-1.0", model_provider: "meta", transcript_path: null };

test("post: Claude structured success/failure and Codex command/patch payloads", () => {
  const c = toolResult({ ...base, ...claude, tool_response: { stdout: "ok", stderr: "", interrupted: false, isImage: false } }).it;
  assert.equal(c.success, true);
  assert.equal(c.exit_code, null, "do not invent an exit code");
  const failed = toolResult({ ...base, ...claude, hook_event_name: "PostToolUseFailure", error: "Exit code 1\nAssertion failed" }).it;
  assert.equal(failed.success, false);
  assert.equal(failed.exit_code, 1);
  for (const response of [{ exit_code: 2, output: "fail" }, "Wall time: 1\nProcess exited with code 2\nOutput:\nfail", JSON.stringify({ exit_code: 2 })]) {
    const it = toolResult({ ...base, ...codex, tool_response: response }).it;
    assert.equal(it.success, false);
    assert.equal(it.exit_code, 2);
  }
  assert.equal(toolResult({ ...base, ...codex, tool_response: "tests passed" }).it.success, null, "unstructured prose isn't proof");
  const patch = toolResult({ ...base, ...codex, tool_name: "apply_patch", tool_input: { command: "*** Begin Patch\n*** Update File: a.mjs\n+x\n*** Move to: b.mjs\n*** End Patch" }, tool_response: "Success. Updated the following files:\nM b.mjs" }).it;
  assert.equal(patch.success, true);
  assert.deepEqual(patch.changes, [{ path: "a.mjs" }, { path: "b.mjs" }]);
});

test("post: Muse completed results replace attempts, failed edits don't count", async () => {
  setJevTransport(async (body) => ({ answers: Object.fromEntries(Object.keys(body.questions).map((id) => [id, { noul: 0.05 }])) }));
  const input = { ...muse, session_id: "muse-results" };
  await onPrompt({ ...input, prompt: "fix the code" });
  await onTool({ ...input, tool_use_id: "edit", tool_name: "write_file", tool_input: { path: "a.mjs", content: "export const x = 1" } });
  onPost({ ...input, hook_event_name: "PostToolUse", tool_use_id: "edit", tool_name: "write_file", tool_input: { path: "a.mjs" }, tool_response: { success: true } });
  await onTool({ ...input, tool_use_id: "test", tool_name: "bash", tool_input: { command: "npm test" } });
  onPost({ ...input, hook_event_name: "PostToolUse", tool_use_id: "test", tool_name: "bash", tool_input: { command: "npm test" }, tool_response: { exit_code: 1 } });
  let stopCalls = 0;
  setJevTransport(() => { stopCalls += 1; assert.fail("critic-off Stop must not call the model"); });
  assert.equal(await onStop({ ...input, last_assistant_message: "Done" }), null);
  assert.equal(stopCalls, 0);
  const session = loadSession(input.session_id);
  const evidence = turnEvidence(mergeToolResults(session.hookItems, session.hookResults));
  assert.equal(evidence.commands_run, 1, "attempt and result aren't double-counted");
  assert.deepEqual(evidence.actions_after_last_edit, [], "edit completion time is unknown");
  assert.ok(evidence.recent_actions.some((action) => /failed, exit 1: npm test/.test(action)), "failed result is still visible");
  assert.deepEqual(evidence.checks_after_last_edit, [{ command: "npm test", success: null, exit_code: 1 }], "receipt-only timing cannot prove a check followed the edit");
  onPost({ ...input, hook_event_name: "PostToolUse", tool_use_id: "edit", tool_name: "write_file", tool_input: { path: "a.mjs" }, tool_response: { success: false } });
  const s = loadSession(input.session_id);
  assert.equal(turnEvidence(mergeToolResults(s.hookItems, s.hookResults)).edited, false);
});

test("post: completed checks after the LAST edit, pending background commands never pass", () => {
  const row = (t, type, more) => ({ t, it: { type, ...more } });
  const items = [row(1, "FileChange", { changes: [{ path: "a.mjs" }], success: true }), row(2, "CommandExecution", { command: "npm test", exit_code: 0 }), row(3, "FileChange", { changes: [{ path: "b.mjs" }], success: true })];
  assert.deepEqual(turnEvidence(items).checks_after_last_edit, []);
  const pending = toolResult({ ...base, ...codex, tool_response: { session_id: 42, exit_code: null } }, { now: 4, startedAt: 4 });
  assert.equal(pending.it.completed, false);
  assert.equal(pending.it.success, null);
  const finished = toolResult({ ...base, ...codex, tool_response: { exit_code: 0 } }, { now: 5, startedAt: 4, endedAt: 5 });
  const merged = mergeToolResults([...items, pending], [finished]);
  assert.equal(merged.length, 4);
  assert.deepEqual(turnEvidence(merged).checks_after_last_edit, [{ command: "npm test", success: true, exit_code: 0 }]);
  assert.equal(toolResult({ ...base, ...claude, tool_response: { backgroundTaskId: "task", stdout: "started" } }).it.success, null);
});

test("post: results supplement and deduplicate transcript commands by call id", () => {
  const items = [{ t: 1, it: { type: "FileChange", changes: [{ path: "a.mjs" }] } }, { t: 2, it: { type: "CommandExecution", id: "t", command: "npm test", exit_code: null } }];
  const result = toolResult({ ...base, ...codex, tool_response: { exit_code: 0 } }, { now: 3, startedAt: 2, endedAt: 3 });
  const merged = mergeToolResults(items, [result]);
  assert.equal(merged.length, 2);
  assert.equal(turnEvidence(merged).checks_after_last_edit[0].success, true);
});

test("post: a command-written file invalidates checks before its mtime", () => {
  const cwd = mkdtempSync(join(tmpdir(), "jevis-post-mtime-"));
  const file = join(cwd, "written-by-script.mjs");
  writeFileSync(file, "export const changed = true");
  utimesSync(file, new Date(3000), new Date(3000));
  const items = [
    { t: 1000, it: { type: "FileChange", changes: [{ path: "a.mjs" }] } },
    { t: 2000, it: { type: "CommandExecution", command: "npm test", exit_code: 0 } },
    { t: 4000, execution: { start: 3500, end: 4000 }, it: { type: "CommandExecution", command: "npm run lint", exit_code: 1 } },
  ];
  const evidence = withTouched(turnEvidence(items), cwd, 500, items);
  assert.deepEqual(evidence.files_written_by_commands, ["written-by-script.mjs"]);
  assert.deepEqual(evidence.checks_after_last_edit, [{ command: "npm run lint", success: false, exit_code: 1 }]);
  assert.deepEqual(evidence.actions_after_last_edit, ["exit 1: npm run lint"]);
});

test("post: no network, bounded unchanged private state, turn isolation and disk fail-open", () => {
  setJevTransport(() => assert.fail("post must never call Jev"));
  const secret = "private-probe-only-value";
  const started = performance.now();
  assert.equal(onPost({ ...base, ...codex, session_id: "privacy", tool_input: { command: `API_KEY=${secret} npm test ` + "x".repeat(8000) }, tool_response: { exit_code: 0, stdout: secret } }), null);
  const ms = performance.now() - started;
  assert.ok(ms < 50, `local post handler ${ms.toFixed(2)} ms`);
  const disk = readFileSync(join(process.env.JEVIS_HOME, "sessions", "privacy.json"), "utf8");
  assert.equal(disk.includes(secret), true);
  assert.ok(loadSession("privacy").hookResults[0].it.command.length <= RESULT_CLIP + 1);
  for (let i = 0; i <= RESULT_MEMORY; i++) onPost({ ...base, ...codex, session_id: "bounded", tool_use_id: `t${i}`, tool_response: { exit_code: 0 } });
  assert.equal(loadSession("bounded").hookResults.length, RESULT_MEMORY);
  const file = join(process.env.JEVIS_HOME, "sessions", "old-turn.json");
  writeFileSync(file, JSON.stringify({ turnId: "turn-2" }));
  onPost({ ...base, ...codex, session_id: "old-turn", tool_response: { exit_code: 0 } });
  assert.equal(loadSession("old-turn").hookResults, undefined);
  mkdirSync(join(process.env.JEVIS_HOME, "sessions", "cannot-write.json"));
  assert.equal(onPost({ ...base, ...codex, session_id: "cannot-write", tool_response: { exit_code: 0 } }), null);
});

test("post: delayed receipt cannot move an old check after a later edit", () => {
  const items = [
    { t: 100, it: { type: "FileChange", changes: [{ path: "a.mjs" }] } },
    { t: 200, execution: { start: 150, end: 200 }, it: { type: "CommandExecution", id: "t", command: "npm test", exit_code: 0 } },
    { t: 300, it: { type: "FileChange", changes: [{ path: "a.mjs" }] } },
  ];
  const receipt = toolResult({ ...base, ...codex, tool_response: { exit_code: 0 } }, { now: 400 });
  const merged = mergeToolResults(items, [receipt]);
  const check = merged.find((row) => row.it.id === "t");
  assert.equal(check.t, 200);
  assert.equal(check.receivedAt, 400);
  assert.deepEqual(check.execution, { start: 150, end: 200 });
  assert.deepEqual(turnEvidence(merged).checks_after_last_edit, []);
});

test("post: unknown execution time and checks overlapping an edit are unverified", () => {
  const edit = { t: 300, it: { type: "FileChange", changes: [{ path: "a.mjs" }] } };
  const receipt = toolResult({ ...base, ...codex, tool_response: { exit_code: 0 } }, { now: 400 });
  for (const items of [
    [edit, receipt],
    [edit, { t: 400, it: { type: "CommandExecution", command: "npm test", exit_code: 0 } }],
    [edit, { t: 400, execution: { start: 200, end: 400 }, it: { type: "CommandExecution", command: "npm test", exit_code: 0 } }],
    [{ ...edit, t: null }, { t: 400, execution: { start: 350, end: 400 }, it: { type: "CommandExecution", command: "npm test", exit_code: 0 } }],
    [{ ...edit, t: 100, it: { ...edit.it, attempted: true } }, { t: 400, execution: { start: 350, end: 400 }, it: { type: "CommandExecution", command: "npm test", exit_code: 0 } }],
  ]) assert.equal(turnEvidence(items).checks_after_last_edit[0].success, null);
  const good = { t: 400, execution: { start: 350, end: 400 }, it: { type: "CommandExecution", command: "npm test", exit_code: 0 } };
  assert.equal(turnEvidence([good, edit]).checks_after_last_edit[0].success, true, "execution order, not insertion order");
});

test("post: transcript execution intervals survive delayed receipts across both harnesses", () => {
  const at = (t) => new Date(t).toISOString();
  const call = (t, id, name, input) => ({ type: "assistant", timestamp: at(t), message: { content: [{ type: "tool_use", id, name, input }] } });
  const result = (t, id) => ({ type: "user", timestamp: at(t), message: { content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] } });
  const claudeRows = [
    call(200, "synthetic-check", "Bash", { command: "npm test" }),
    call(250, "synthetic-edit", "Write", { file_path: "a.mjs" }),
    result(300, "synthetic-edit"), result(400, "synthetic-check"),
  ];
  const file = join(process.env.JEVIS_HOME, "synthetic-timing-rollout.jsonl");
  writeFileSync(file, [
    { type: "event_msg", timestamp: at(300), payload: { type: "item_completed", started_at_ms: 250, completed_at_ms: 300, item: { type: "FileChange", id: "synthetic-edit", changes: [{ path: "a.mjs" }] } } },
    { type: "event_msg", timestamp: at(400), payload: { type: "item_completed", started_at_ms: 200, completed_at_ms: 400, item: { type: "CommandExecution", id: "synthetic-check", command: "npm test", exit_code: 0 } } },
  ].map(JSON.stringify).join("\n") + "\n");
  for (const items of [readClaudeTranscript(claudeRows).items, readRollout(file).items]) {
    const check = items.find((row) => row.it.id === "synthetic-check");
    assert.deepEqual(check.execution, { start: 200, end: 400 });
    const receipt = toolResult({ ...base, ...codex, tool_use_id: "synthetic-check", tool_response: { exit_code: 0 } }, { now: 500 });
    const merged = mergeToolResults(items, [receipt]);
    assert.equal(turnEvidence(merged).checks_after_last_edit[0].success, null, "check overlaps the edit");
    assert.equal(merged.find((row) => row.it.id === "synthetic-check").receivedAt, 500);
  }
});
