import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { WORKER_MARKER } from "../src/context.mjs";
import { onPost, onPrompt, onSession, onTool } from "../src/hooks.mjs";
import { setJevTransport } from "../src/jev.mjs";
import { loadNudges, NUDGES_ROOT } from "../src/nudges.mjs";
import { readLog } from "../src/state.mjs";

const tips = {
  "repeat-failure": "This command has failed twice in a row. Running it again unchanged will fail the same way. Read the actual error, form a new hypothesis, and change something (the code, the command, or the approach) before you run it again. If you're stuck after that, say what you've tried and what you'd try next.",
  "repeat-check": "Nothing has changed since you last ran this check, so it will give the same result. Use the output you already have, or change something first.",
  "port-in-use": "A port is already in use. A server you or the user started is probably still running. Check what owns it (`lsof -i :<port>`). If it's your own earlier dev server, reuse it. Don't kill a process you didn't start, and don't silently switch ports; tell the user if it isn't clear whose it is.",
};
const root = mkdtempSync(join(tmpdir(), "jevis-midsession-"));
after(() => { setJevTransport(null); rmSync(root, { recursive: true, force: true }); });
let cwd, sequence, calls;
beforeEach(() => {
  for (const key of Object.keys(process.env)) if (key.startsWith("JEVIS_") || ["AGENT_CALL_DEPTH", "BROKER_DEPTH", "BROKER_JOB_ID"].includes(key)) delete process.env[key];
  cwd = mkdtempSync(join(root, "case-"));
  Object.assign(process.env, { JEVIS_HOME: join(cwd, "home"), JEVIS_NUDGES_DIR: join(cwd, "nudges"), JEVIS_WIKI: join(cwd, "wiki"), JEVIS_JEV: "off" });
  for (const dir of [process.env.JEVIS_HOME, process.env.JEVIS_NUDGES_DIR, process.env.JEVIS_WIKI]) mkdirSync(dir);
  for (const hook of Object.keys(tips)) copyFileSync(join(NUDGES_ROOT, `base-${hook}.md`), join(process.env.JEVIS_NUDGES_DIR, `base-${hook}.md`));
  sequence = 0; calls = [];
  setJevTransport(async (body) => {
    calls.push(body);
    return { answers: Object.fromEntries(Object.keys(body.questions).map((key) => [key, { noul: 0.99 }])) };
  });
});
const context = (result) => result?.hookSpecificOutput?.additionalContext;
const tool = (tool_name, tool_input, extra = {}) => onTool({ session_id: "s", cwd, tool_name, tool_input, ...extra });
const bash = (command, extra) => tool("Bash", { command }, extra);
const prompt = (text = "Continue.") => onPrompt({ session_id: "s", cwd, model: "gpt-6.1-sol", prompt: text });
const post = (command, response, extra = {}) => onPost({ session_id: "s", cwd, hook_event_name: "PostToolUse", tool_use_id: `result-${++sequence}`, tool_name: "Bash", tool_input: { command }, tool_response: response, ...extra });
const edit = () => tool("Edit", { file_path: "src/a.mjs", new_string: "changed" });

test("mid-session tips ship exact family-independent copy", () => {
  const loaded = loadNudges();
  assert.deepEqual(loaded.broken, []);
  for (const [hook, text] of Object.entries(tips)) {
    const nudge = loaded.nudges.find((n) => n.hook === hook);
    assert.equal(nudge.text, text);
    assert.equal(nudge.family, undefined);
    assert.ok(nudge.text.length <= 1500);
  }
});

test("repeat-failure: last two recorded outcomes, whitespace-normalized keys, once per key per session", async () => {
  assert.equal(await bash("node broken.mjs"), null);
  post("node broken.mjs", { exit_code: 1 });
  assert.equal(await bash("node broken.mjs"), null, "one failure is not enough");
  post("node broken.mjs", { success: false });
  assert.equal(await bash("node other.mjs"), null, "different key");
  assert.equal(context(await bash(" node   broken.mjs ")), tips["repeat-failure"]);
  assert.equal(await bash("node broken.mjs"), null);
  await prompt();
  assert.equal(await bash("node broken.mjs"), null, "not reset by a new turn");
  post("node other.mjs", { exit_code: 2 });
  post("node other.mjs", { exit_code: 2 });
  assert.equal(context(await bash("node other.mjs")), tips["repeat-failure"], "each command has its own allowance");
  assert.deepEqual(readLog().filter((r) => r.event === "nudge").map((r) => r.hook), ["repeat-failure", "repeat-failure"]);
});

test("repeat-failure: success or unknown outcome interrupts failures; pending and duplicate results aren't two runs", async () => {
  post("node broken.mjs", { exit_code: 1 });
  post("node broken.mjs", { exit_code: 0 });
  post("node broken.mjs", { exit_code: 1 });
  assert.equal(await bash("node broken.mjs"), null, "success in between");
  post("node broken.mjs", "unknown outcome");
  post("node broken.mjs", { exit_code: 1 });
  assert.equal(await bash("node broken.mjs"), null, "unknown is not a failure");
  post("node pending.mjs", { session_id: 42, exit_code: null });
  post("node pending.mjs", { exit_code: 1 });
  assert.equal(await bash("node pending.mjs"), null, "a running process is not a failed run");
  post("node duplicate.mjs", { exit_code: 1 }, { tool_use_id: "same" });
  post("node duplicate.mjs", { exit_code: 1 }, { tool_use_id: "same" });
  assert.equal(await bash("node duplicate.mjs"), null, "same completion twice");
  post("node idless.mjs", { exit_code: 1 }, { tool_use_id: undefined });
  post("node idless.mjs", { exit_code: 1 }, { tool_use_id: undefined });
  assert.equal(context(await bash("node idless.mjs")), tips["repeat-failure"], "id-less harnesses still record consecutive failures");
});

test("repeat-failure: history survives turn changes; only Bash calls trigger", async () => {
  post("node broken.mjs", { exit_code: 1 });
  await prompt();
  post("node broken.mjs", { exit_code: 1 });
  assert.equal(await tool("Read", { file_path: "node broken.mjs" }), null);
  assert.equal(context(await bash("node broken.mjs")), tips["repeat-failure"]);
});

test("repeat-check: repeated checks only, once per turn, and a recorded edit invalidates prior checks", async () => {
  assert.equal(await bash("npm test"), null);
  assert.equal(context(await bash("npm test")), tips["repeat-check"]);
  assert.equal(await bash("npm run build"), null);
  assert.equal(await bash("npm run build"), null, "one tip covers every check this turn");
  await prompt();
  assert.equal(context(await bash("npm test")), tips["repeat-check"], "fresh turn, same unchanged check");
  await prompt();
  await edit();
  assert.equal(await bash("npm test"), null, "edit since its last run");
  assert.equal(context(await bash("npm test")), tips["repeat-check"]);
  await prompt();
  assert.equal(await bash("echo hello"), null);
  assert.equal(await bash("echo hello"), null, "not a check");
  assert.equal(await bash('echo "npm test"'), null);
  assert.equal(await bash('echo "npm test"'), null, "runner names in arguments aren't checks");
});

test("repeat-check: reuses Stop's common check runners", async () => {
  for (const command of ["npm test", "npm run typecheck", "pnpm build", "yarn lint", "bun test", "npx vitest run", "jest", "pytest -q", "cargo test", "cargo build", "go test ./...", "tsc --noEmit", "eslint .", "node --test tests/a.mjs"]) {
    await prompt();
    assert.equal(await bash(command), null, command);
    assert.equal(context(await bash(command)), tips["repeat-check"], command);
  }
});

test("port-in-use: next tool, any result tool, each spelling and case, once per session", async () => {
  assert.equal(await tool("Read", { file_path: "a.mjs" }), null, "no error");
  post("npm start", { exit_code: 0, stdout: "ready" });
  assert.equal(await bash("echo ok"), null);
  post("echo EADDRINUSE", { exit_code: 0, stdout: "ready" });
  assert.equal(await bash("echo ok"), null, "only result text counts, not a command mentioning the error");
  post("cat src/hooks.mjs", { exit_code: 0, stdout: "const PORT_IN_USE = /EADDRINUSE|address already in use/" });
  assert.equal(await bash("echo ok"), null, "a successful call whose output mentions the error is not a port error");
  for (const error of ["listen EADDRINUSE: 3000", "Address Already In Use", "Port 5173 is already in use"]) {
    const session_id = `port-${++sequence}`;
    onPost({ session_id, cwd, tool_name: "SomeTool", tool_response: { stderr: error, exit_code: 1 } });
    assert.equal(context(await tool("Read", { file_path: "a.mjs" }, { session_id })), tips["port-in-use"]);
    assert.equal(await bash("echo ok", { session_id }), null);
  }
  post("npm start", null, { hook_event_name: "PostToolUseFailure", error: "eaddrinuse" });
  await prompt();
  assert.equal(context(await tool("Read", { file_path: "a.mjs" })), tips["port-in-use"], "pending tip survives a turn");
  post("npm start", { exit_code: 1, stderr: "address already in use" });
  await prompt();
  assert.equal(await bash("echo ok"), null, "a new error does not renew the allowance");
});

test("mid-session tips reset session allowances on compact and clear", async () => {
  post("node broken.mjs", { exit_code: 1, stderr: "EADDRINUSE" });
  post("node broken.mjs", { exit_code: 1 });
  const expected = `${tips["repeat-failure"]}\n\n${tips["port-in-use"]}`;
  assert.equal(context(await bash("node broken.mjs")), expected);
  for (const source of ["compact", "clear"]) {
    onSession({ session_id: "s", cwd, source });
    assert.equal(context(await bash("node broken.mjs")), tips["repeat-failure"], `${source}: the port tip needs a new port error`);
    assert.equal(await bash("node broken.mjs"), null);
  }
});

test("mid-session tips respect shadow/off without spending allowances, and log each fired tip", async () => {
  await bash("npm test");
  post("node broken.mjs", { exit_code: 1, stdout: "EADDRINUSE" });
  post("node broken.mjs", { exit_code: 1 });
  for (const [key, value] of [["JEVIS_MODE", "shadow"], ["JEVIS_NUDGES", "off"]]) {
    process.env[key] = value;
    assert.equal(await bash("node broken.mjs"), null);
    assert.equal(await bash("npm test"), null);
    delete process.env[key];
  }
  assert.equal(readLog().some((r) => r.event === "nudge"), false);
  assert.equal(context(await bash("npm test")), `${tips["repeat-check"]}\n\n${tips["port-in-use"]}`);
  assert.equal(context(await bash("node broken.mjs")), tips["repeat-failure"]);
  const rows = readLog().filter((r) => r.event === "nudge");
  assert.deepEqual(rows.map((r) => r.hook), ["repeat-check", "port-in-use", "repeat-failure"]);
  assert.ok(rows.every((r) => r.sessionId === "s" && r.ids[0] === `base-${r.hook}` && Number.isInteger(r.turn)));
});

test("workers get all three tips with zero Jev calls", async () => {
  process.env.JEVIS_JEV = "on";
  writeFileSync(join(process.env.JEVIS_WIKI, "tool.md"), "---\nevent: tool\ntools: [Bash]\nask: Does `input` need a note?\naction: context\ntitle: Tool note\nsource: test\n---\nConsider this.\n");
  await prompt(WORKER_MARKER);
  post("node broken.mjs", { exit_code: 1, stderr: "EADDRINUSE" });
  post("node broken.mjs", { exit_code: 1 });
  assert.equal(context(await bash("node broken.mjs")), `${tips["repeat-failure"]}\n\n${tips["port-in-use"]}`);
  assert.equal(await bash("npm test"), null);
  assert.equal(context(await bash("npm test")), tips["repeat-check"]);
  assert.deepEqual(calls, []);
  assert.deepEqual(readLog().filter((r) => r.event === "nudge").map((r) => r.hook), ["repeat-failure", "port-in-use", "repeat-check"]);
});
