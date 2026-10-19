import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { readConfig, SETTINGS } from "../src/config.mjs";
import { isWorkerPrompt, WORKER_MARKER } from "../src/context.mjs";
import { evaluate } from "../src/engine.mjs";
import { onPrompt, onSession, onStop, onTool } from "../src/hooks.mjs";
import { setJevTransport } from "../src/jev.mjs";
import { setCapture, setCritic } from "../src/review.mjs";
import { loadSession, log, readLog, saveSession } from "../src/state.mjs";
import { loadWiki, parseEntry, validateEntry, WIKI_ROOT } from "../src/wiki.mjs";

const root = mkdtempSync(join(tmpdir(), "jevis-worker-"));
const cli = fileURLToPath(new URL("../bin/jevis.mjs", import.meta.url));
after(() => rmSync(root, { recursive: true, force: true }));
let cwd, calls, external;
beforeEach(() => {
  for (const key of Object.keys(process.env)) if (key.startsWith("JEVIS_") || ["AGENT_CALL_DEPTH", "BROKER_DEPTH", "BROKER_JOB_ID"].includes(key)) delete process.env[key];
  const fixture = mkdtempSync(join(root, "case-"));
  cwd = join(fixture, "workspace");
  mkdirSync(cwd);
  process.env.JEVIS_HOME = join(fixture, "home");
  process.env.JEVIS_NUDGES_DIR = join(fixture, "nudges");
  process.env.JEVIS_WIKI = join(fixture, "wiki");
  process.env.JEVIS_CRITIC = "claude";
  process.env.JEVIS_JEV = "on";
  for (const dir of [process.env.JEVIS_HOME, process.env.JEVIS_NUDGES_DIR, process.env.JEVIS_WIKI]) mkdirSync(dir);
  for (const hook of ["session", "prompt", "feedback", "feedback-repeat", "ui-edit"]) writeFileSync(join(process.env.JEVIS_NUDGES_DIR, `${hook}.md`), `---\nhook: ${hook}\n---\n${hook} tip.\n`);
  writeFileSync(join(process.env.JEVIS_WIKI, "tool.md"), "---\nevent: tool\ntools: [Edit, Bash]\nask: Does `input` need a note?\naction: context\ntitle: Tool note\nsource: test\n---\nConsider this.\n");
  calls = []; external = [];
  setJevTransport(async (body) => {
    calls.push(body);
    return { answers: Object.fromEntries(Object.keys(body.questions).map((key) => [key, { noul: 0.99 }])) };
  });
  setCapture(async () => { external.push("capture"); throw new Error("unexpected capture"); });
  setCritic(async () => { external.push("critic"); throw new Error("unexpected critic"); });
});
const prompt = (session_id, text) => onPrompt({ session_id, cwd, model: "gpt-6.1-sol", prompt: text });
const tool = (session_id) => onTool({ session_id, cwd, tool_name: "Edit", tool_input: { file_path: join(cwd, "a.css"), new_string: "h1 { color: purple }" } });
const context = (result) => result?.hookSpecificOutput?.additionalContext;

test("worker detection: marker normalization, request extraction, env and non-workers", () => {
  assert.equal(isWorkerPrompt(`${WORKER_MARKER} Fix x.`, {}), true);
  assert.equal(isWorkerPrompt("YOU were\n called BY another\t agent. Do THIS task yourself. Fix x.", {}), true);
  assert.equal(isWorkerPrompt("## attachment: /tmp/file\n## My request:\n" + WORKER_MARKER, {}), true);
  for (const env of [{ AGENT_CALL_DEPTH: "1" }, { AGENT_CALL_DEPTH: "2" }, { BROKER_DEPTH: "0" }, { BROKER_JOB_ID: "job" }]) assert.equal(isWorkerPrompt("Fix x.", env), true);
  assert.equal(isWorkerPrompt("[agent] Fix x.", {}), true);
  for (const text of ["Fix x.", "", "Another agent might help", "You were called by a person."]) assert.equal(isWorkerPrompt(text, {}), false);
  assert.equal(isWorkerPrompt("Fix x.", { AGENT_CALL_DEPTH: "0" }), false);
  assert.equal(isWorkerPrompt("Delegated\n task: Fix x.", { JEVIS_WORKER_MARKER: "delegated task:" }), true);
  assert.equal(isWorkerPrompt(WORKER_MARKER, { JEVIS_WORKER_MARKER: "delegated task:" }), false);
});

test("worker marker is a configurable text setting", () => {
  const file = join(process.env.JEVIS_HOME, "config.json");
  writeFileSync(file, JSON.stringify({ JEVIS_WORKER_MARKER: "Delegated task:" }));
  assert.deepEqual(readConfig(file).values, { JEVIS_WORKER_MARKER: "Delegated task:" });
  assert.deepEqual(readConfig(file).errors, []);
  assert.equal(SETTINGS.JEVIS_WORKER_MARKER.help, "the phrase that marks a session started by another agent");
  writeFileSync(file, JSON.stringify({ JEVIS_WORKER_MARKER: true }));
  assert.equal(readConfig(file).errors.length, 1);
});

test("workers keep session and UI tips, suppress prompt and both feedback tips, and never call Jev on tools", async () => {
  const id = "worker";
  assert.equal(context(onSession({ session_id: id, cwd, model: "gpt-6.1-sol", source: "startup" })), "session tip.");
  assert.equal(await prompt(id, `${WORKER_MARKER} Fix x.`), null);
  assert.equal(loadSession(id).worker, true);
  assert.equal(context(await tool(id)), "ui-edit tip.");
  assert.equal(await tool(id), null, "UI tip is still once per turn");
  for (const text of ["not good", "try again"]) assert.equal(await prompt(id, text), null);
  assert.equal(context(await tool(id)), "ui-edit tip.");
  assert.equal(loadSession(id).hookItems.length, 1, "attempted tool evidence is retained");
  await onTool({ session_id: id, cwd, tool_name: "Bash", tool_input: { command: "npm test" } });
  assert.equal(loadSession(id).commands.length, 1);
  assert.deepEqual(calls, []);
  const rows = readLog().filter((r) => ["prompt", "tool"].includes(r.event));
  assert.ok(rows.every((r) => r.worker === true));
  assert.ok(rows.filter((r) => r.event === "tool").every((r) => r.skipped === "worker"));
  assert.deepEqual(readLog().filter((r) => r.event === "nudge").map((r) => r.hook), ["session", "ui-edit", "ui-edit"]);
  assert.equal(existsSync(join(process.env.JEVIS_HOME, "jev")), false);
  onSession({ session_id: id, cwd, source: "clear" });
  assert.equal(loadSession(id).worker, true, "worker status is sticky even across a clear");
});

test("marker is first-prompt only; env markers on later prompts become sticky", async () => {
  assert.equal(context(await prompt("person", "Fix x.")), "prompt tip.");
  assert.equal(context(await prompt("person", WORKER_MARKER)), "prompt tip.");
  assert.equal(loadSession("person").worker, undefined);
  await tool("person");
  assert.equal(calls.length, 1, "non-worker tool fixture really calls Jev");
  process.env.AGENT_CALL_DEPTH = "1";
  assert.equal(await prompt("person", "not good"), null);
  delete process.env.AGENT_CALL_DEPTH;
  assert.equal(await prompt("person", "try again"), null);
  const before = calls.length;
  await tool("person");
  assert.equal(calls.length, before);
  assert.equal(loadSession("person").worker, true);
});

test("worker Stop keeps the code check but makes no Jev or critic calls, even with reviewable edits", async () => {
  const id = "stop-worker";
  await prompt(id, WORKER_MARKER);
  // Use the shipped Stop check plus a custom exception that would otherwise call Jev.
  const shipped = loadWiki([WIKI_ROOT]).entries[0];
  const exception = { ...shipped, id: "exception", unless: "Does `request` make this irrelevant?" };
  const local = await evaluate({ event: "stop", state: { final_message: "Tests pass.", evidence: { edited: true, checks_after_last_edit: [{ command: "npm test", success: false }] } }, wiki: { entries: [shipped, exception, { ...shipped, id: "model-only", decide: undefined }] }, codeOnly: true, axes: false, local: true });
  assert.deepEqual(local.fired.map((e) => e.id), [shipped.id]);
  assert.equal(local.jevQuestions, 0);
  process.env.JEVIS_WIKI = WIKI_ROOT;
  const session = loadSession(id), t = session.turnStartedAt;
  session.hookItems = [
    { t: t + 1, it: { type: "FileChange", changes: [{ path: join(cwd, "a.css") }] } },
    { t: t + 3, execution: { start: t + 2, end: t + 3 }, it: { type: "CommandExecution", command: "npm test", completed: true, success: false, exit_code: 1 } },
  ];
  saveSession(id, session);
  const input = { session_id: id, cwd, last_assistant_message: "Done. Tests pass." };
  assert.equal((await onStop(input)).decision, "block");
  assert.equal(await onStop(input), null, "same Stop check never loops");
  assert.equal(await onStop({ ...input, last_assistant_message: "Updated the screen." }), null);
  assert.deepEqual(calls, []);
  assert.deepEqual(external, []);
  assert.ok(readLog().filter((r) => r.event === "stop").every((r) => r.worker === true && r.jevQuestions === 0));
  assert.equal(existsSync(join(process.env.JEVIS_HOME, "jev")), false);
});

test("lint rejects action: deny with the explicit no-refusal error", () => {
  const text = "---\nevent: tool\nask: Does `input` match?\naction: deny\ntitle: Fixture\nsource: test\n---\nAdvice.\n";
  assert.deepEqual(validateEntry(parseEntry(text, "old")), ["Jevis never refuses a call: use action: context"]);
  writeFileSync(join(process.env.JEVIS_WIKI, "old.md"), text);
  const result = spawnSync(process.execPath, [cli, "lint"], { env: process.env, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Jevis never refuses a call: use action: context/);
});

test("prompts and logs preserve values without filtering", async () => {
  const request = "Use API_KEY=fictional-test-value token=example-only";
  await prompt("unchanged", request);
  assert.equal(loadSession("unchanged").request, request);
  log({ event: "fixture", token: "example-only", nested: { password: "fictional-test-value" } });
  const row = readLog().at(-1);
  assert.equal(row.token, "example-only");
  assert.equal(row.nested.password, "fictional-test-value");
  assert.ok(readFileSync(join(process.env.JEVIS_HOME, "log.jsonl"), "utf8").includes(request));
});

test("configured marker replaces the default in the real CLI prompt hook", () => {
  writeFileSync(join(process.env.JEVIS_HOME, "config.json"), JSON.stringify({ JEVIS_WORKER_MARKER: "Delegated task:" }));
  const result = spawnSync(process.execPath, [cli, "hook", "prompt"], {
    env: process.env, encoding: "utf8", input: JSON.stringify({ session_id: "configured", cwd, model: "gpt-6.1-sol", prompt: "DELEGATED\n TASK: Fix x." }),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(loadSession("configured").worker, true);
});
