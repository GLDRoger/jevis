import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../bin/jevis.mjs", import.meta.url));
const GOOGLE = fileURLToPath(new URL("../bin/google-hook.mjs", import.meta.url));
const OUTAGE = "Jevis is unavailable right now.";
const fixture = (t) => {
  const home = mkdtempSync(join(tmpdir(), "jevis-hook-output-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("JEVIS_")));
  return { home, env: { ...env, JEVIS_HOME: home, JEVIS_NUDGES: "off", JEVIS_CRITIC: "off" } };
};
const run = (file, args, input, env) => new Promise((resolve, reject) => {
  const child = execFile(process.execPath, [file, ...args], { env, timeout: 10_000 }, (error, stdout, stderr) => {
    if (error) return reject(error);
    assert.equal(stderr, "");
    resolve(stdout);
  });
  child.stdin.end(typeof input === "string" ? input : JSON.stringify(input));
});
const outage = (home, count = 3) => writeFileSync(join(home, "jev-health.json"), JSON.stringify({ since: Date.now() - 1000, lastAt: Date.now(), count, class: "auth/billing", classes: { "auth/billing": count }, status: 402 }));

test("hook stdout: native outage is exact, gated at three failures, once per session, and silent off/shadow", async (t) => {
  const { home, env } = fixture(t);
  const input = { session_id: "outage", cwd: home, prompt: "hello" };
  for (const count of [1, 2]) {
    outage(home, count);
    assert.equal(await run(CLI, ["hook", "prompt"], input, env), "");
  }
  outage(home);
  assert.equal(await run(CLI, ["hook", "prompt"], input, env), JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: OUTAGE } }));
  assert.equal(await run(CLI, ["hook", "session"], input, env), "");
  for (const mode of [{ JEVIS_MODE: "shadow" }, { JEVIS_JEV: "off" }]) {
    for (const kind of ["prompt", "session"]) {
      assert.equal(await run(CLI, ["hook", kind], { ...input, session_id: `${kind}-${Object.values(mode)[0]}` }, { ...env, ...mode }), "");
    }
  }
  const session = await run(CLI, ["hook", "session"], { ...input, session_id: "session-first" }, env);
  assert.equal(JSON.parse(session).hookSpecificOutput.additionalContext, OUTAGE);
  assert.equal(await run(CLI, ["hook", "prompt"], { ...input, session_id: "session-first" }, env), "");
});

test("hook stdout: Google adapters pass only the generic outage and keep the once-per-session rule", async (t) => {
  const { home, env } = fixture(t);
  outage(home);
  for (const provider of ["gemini-cli", "antigravity"]) {
    const input = provider === "gemini-cli" ? { session_id: "google", cwd: home } : { conversationId: "google", workspacePaths: [home] };
    const output = JSON.parse(await run(GOOGLE, [provider, "SessionStart"], input, env));
    assert.deepEqual(output, provider === "gemini-cli"
      ? { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: OUTAGE } }
      : { injectSteps: [{ ephemeralMessage: OUTAGE }] });
    assert.equal(await run(GOOGLE, [provider, "SessionStart"], input, env), "{}");
  }
});

test("hook stdout: malformed inputs and thrown handlers never print exceptions", async (t) => {
  const { home, env } = fixture(t);
  for (const kind of ["prompt", "tool", "post", "stop", "session"]) {
    assert.equal(await run(CLI, ["hook", kind], "{ private-invalid-json", env), "");
    assert.equal(await run(CLI, ["hook", kind], "null", env), "");
  }
  for (const [provider, event, expected] of [["gemini-cli", "BeforeAgent", "{}"], ["antigravity", "PreToolUse", '{"decision":"allow"}']]) {
    assert.equal(await run(GOOGLE, [provider, event], "{ private-invalid-json", env), expected);
    assert.equal(await run(GOOGLE, [provider, event], "null", env), expected);
  }
  assert.match(readFileSync(join(home, "log.jsonl"), "utf8"), /hook-error/);
});

test("hook stdout: HTTP failures stay in health and local logs, never native or Google tool output", async (t) => {
  const { home, env } = fixture(t);
  const wiki = join(home, "wiki");
  mkdirSync(wiki);
  writeFileSync(join(wiki, "fixture.md"), "---\nevent: tool\ntools: [Write]\nask: Does `input` match?\nunless: Does `request` ask for it?\naction: context\ntitle: Fixture lesson\nsource: test\n---\nUse the alternative.\n");
  const server = createServer((req, res) => {
    req.resume();
    res.writeHead(402, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "private-error-marker\n    at privateStack" } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const settings = { ...env, JEVIS_WIKI: wiki, JEVIS_JEV_KEY: "test-only", JEVIS_JEV_URL: `http://127.0.0.1:${server.address().port}/v1/systemone` };
  const tool_input = { file_path: "a.txt", content: "fixture" };
  assert.equal(await run(CLI, ["hook", "tool"], { session_id: "http", cwd: home, tool_name: "Write", tool_input }, settings), "");
  assert.equal(await run(GOOGLE, ["gemini-cli", "BeforeTool"], { session_id: "http", cwd: home, tool_name: "write_file", tool_input }, settings), "{}");
  assert.equal(await run(GOOGLE, ["antigravity", "PreToolUse"], { conversationId: "http", workspacePaths: [home], toolCall: { name: "write_file", args: tool_input } }, settings), '{"decision":"allow"}');
  const health = JSON.parse(readFileSync(join(home, "jev-health.json"), "utf8"));
  assert.equal(health.count, 3);
  assert.equal(health.status, 402);
  assert.equal(health.class, "auth/billing");
  assert.match(readFileSync(join(home, "log.jsonl"), "utf8"), /HTTP 402: private-error-marker/);
  const prompt = await run(CLI, ["hook", "prompt"], { session_id: "http", cwd: home, prompt: "hello" }, settings);
  assert.equal(JSON.parse(prompt).hookSpecificOutput.additionalContext, OUTAGE);
});
