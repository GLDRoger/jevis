import { test } from "node:test";
import assert from "node:assert/strict";
import { harnessOf, hookItem, museTool, turnEvidence } from "../src/context.mjs";

// Shapes captured from Muse Code 1.4.6 hook payloads.
const base = { session_id: "s", cwd: "/w", transcript_path: null, model: "muse-wonder-1.0", permission_mode: "bypassPermissions", model_provider: "meta" };

test("muse: harness is Muse Code with its model, not Codex", () => {
  assert.deepEqual(harnessOf(base), { harness: "Muse Code", model: "muse-wonder-1.0" });
  assert.equal(harnessOf({ model: "gpt-6.1-sol" }).harness, "Codex");
});

test("muse: tools are renamed to the Claude tools lessons name", () => {
  assert.deepEqual(museTool("bash", { command: "npm test", workdir: "/w" }), { tool: "Bash", input: { command: "npm test" } });
  assert.deepEqual(museTool("write_file", { path: "a.css", content: "x" }), { tool: "Write", input: { file_path: "a.css", content: "x" } });
  assert.deepEqual(museTool("edit_file", { path: "a.css", find: "a", replace: "b" }), { tool: "Edit", input: { file_path: "a.css", old_string: "a", new_string: "b" } });
  assert.equal(museTool("submit_reminder_decision", {}).tool, "submit_reminder_decision");
});

test("muse: recorded calls give the Stop hook its evidence", () => {
  const items = [
    { t: 1, it: hookItem("Write", { file_path: "/w/src/App.css" }) },
    { t: 2, it: hookItem("Bash", { command: "npm test" }) },
  ];
  const evidence = turnEvidence(items, { cwd: "/w" });
  assert.equal(evidence.edited, true);
  assert.deepEqual(evidence.files_changed, ["src/App.css"]);
  assert.equal(evidence.commands_run, 1);
  assert.deepEqual(evidence.actions_after_last_edit, ["exit ?: npm test"]);
  assert.equal(hookItem("submit_reminder_decision", {}), null, "harness-internal tools are not evidence");
  assert.deepEqual(hookItem("apply_patch", { input: "*** Begin Patch\n*** Add File: b.txt\n+hi\n*** End Patch" }).changes, [{ path: "b.txt" }]);
});

// Exercise the real hook with private on-disk state, never the user's sessions.
const { mkdtempSync, readFileSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
process.env.JEVIS_HOME = mkdtempSync(join(tmpdir(), "jevis-muse-"));
delete process.env.JEVIS_WIKI;
delete process.env.JEVIS_MODE;
delete process.env.JEVIS_SCOPE;
delete process.env.JEVIS_DISABLE;
const { onTool, onStop, HOOK_ITEM_CLIP } = await import("../src/hooks.mjs");
const { loadSession, saveSession, readLog } = await import("../src/state.mjs");
const { setJevTransport } = await import("../src/jev.mjs");

const scripted = (score = 0.05, capture = () => {}) => setJevTransport(async (body) => {
  capture(body);
  return { answers: Object.fromEntries(Object.keys(body.questions).map((key) => [key, { noul: typeof score === "function" ? score(key) : score }])) };
});

test("muse hook: commands and MCP arguments are redacted and bounded even with recording off", async () => {
  process.env.JEVIS_RECORD = "off";
  scripted();
  const secret = "review-only-not-real";
  const command = `API_KEY=${secret} echo ready ` + "ordinary words ".repeat(1000);
  const session_id = "private-record";
  await onTool({ ...base, session_id, tool_name: "bash", tool_input: { command } });
  const state = loadSession(session_id);
  assert.match(state.hookItems[0].it.command, /API_KEY=\[redacted\] echo ready/);
  assert.ok(state.hookItems[0].it.command.length <= HOOK_ITEM_CLIP + 1);
  await onTool({ ...base, session_id, tool_name: "mcp__browser__run", tool_input: { code: `API_KEY=${secret} ` + "ordinary words ".repeat(1000) } });
  const persisted = readFileSync(join(process.env.JEVIS_HOME, "sessions", `${session_id}.json`), "utf8");
  assert.equal(persisted.includes(secret), false);
  assert.ok(JSON.stringify(loadSession(session_id).hookItems[1].it.arguments).length < HOOK_ITEM_CLIP + 100);
  delete process.env.JEVIS_RECORD;
});

test("muse hook: denied writes never become Stop edit evidence; allowed and shadow writes do", async () => {
  scripted(); // Exact em-dash Write match, exception answer no.
  const session_id = "denied-write";
  const result = await onTool({ ...base, session_id, tool_name: "write_file", tool_input: { path: "src/Denied.html", content: "<p>One — two</p>" } });
  assert.equal(result.hookSpecificOutput.permissionDecision, "deny");
  assert.deepEqual(loadSession(session_id).hookItems ?? [], []);
  let stopCalls = 0;
  scripted(0.05, () => { stopCalls += 1; });
  await onStop({ ...base, cwd: process.env.JEVIS_HOME, session_id, last_assistant_message: "Done." });
  assert.equal(stopCalls, 0);
  const stop = readLog().filter((r) => r.event === "stop" && r.sessionId === session_id).at(-1);
  assert.equal(stop.evidence.edited, false);
  assert.equal(stop.evidence.files, 0);
  assert.deepEqual(turnEvidence(loadSession(session_id).hookItems ?? []).files_changed, []);

  await onTool({ ...base, session_id, tool_name: "write_file", tool_input: { path: "src/Allowed.html", content: "<p>Ready</p>" } });
  assert.deepEqual(turnEvidence(loadSession(session_id).hookItems).files_changed, ["src/Allowed.html"]);
  process.env.JEVIS_MODE = "shadow";
  try {
    await onTool({ ...base, session_id, tool_name: "write_file", tool_input: { path: "src/Shadow.html", content: "<p>One — two</p>" } });
    assert.deepEqual(turnEvidence(loadSession(session_id).hookItems).files_changed, ["src/Allowed.html", "src/Shadow.html"]);
  } finally { delete process.env.JEVIS_MODE; }
});

test("muse hook: skipped and failed-open allowed calls are recorded, but denied commands aren't remembered", async () => {
  scripted();
  const session_id = "permission-memory";
  await onTool({ ...base, session_id, tool_name: "bash", tool_input: { command: "echo ready" } });
  assert.equal(loadSession(session_id).hookItems.length, 1, "plain read is skipped but allowed");
  process.env.JEVIS_ENABLE = "all";
  try {
    const result = await onTool({ ...base, session_id, tool_name: "bash", tool_input: { command: "git clean -fd" } });
    assert.equal(result.hookSpecificOutput.permissionDecision, "deny");
    assert.equal(loadSession(session_id).hookItems.length, 1);
    assert.equal(loadSession(session_id).commands.length, 1);
    setJevTransport(async () => { throw new Error("Jev unavailable"); });
    await onTool({ ...base, session_id, tool_name: "write_file", tool_input: { path: "src/FailOpen.html", content: "<p>One — two</p>" } });
    assert.equal(loadSession(session_id).hookItems.length, 2);
  } finally { delete process.env.JEVIS_ENABLE; scripted(); }
});

test("muse hook: recording after a model answer retains concurrently saved session items", async () => {
  const session_id = "parallel-save";
  scripted(0.05, () => {
    const now = loadSession(session_id);
    now.hookItems = [{ t: 1, it: hookItem("Write", { file_path: "src/Other.html" }) }];
    saveSession(session_id, now);
  });
  await onTool({ ...base, session_id, tool_name: "bash", tool_input: { command: "npm test" } });
  assert.equal(loadSession(session_id).hookItems.length, 2);
});
