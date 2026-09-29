import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const installer = fileURLToPath(new URL("../bin/install.mjs", import.meta.url));
const cli = fileURLToPath(new URL("../bin/jevis.mjs", import.meta.url));
const windows = process.platform === "win32";
const CHILD_TIMEOUT_MS = windows ? 15000 : 5000;
// Windows launches up to 36 cold shells, plus the installer and lint, before cleanup.
const TEST_TIMEOUT_MS = windows ? 4 * 9 * CHILD_TIMEOUT_MS + 2 * CHILD_TIMEOUT_MS + 30000 : 30000;
const envValue = (name) => Object.entries(process.env).find(([key]) => key.toUpperCase() === name.toUpperCase())?.[1];

function executable(paths) {
  return paths.find((path) => {
    try {
      accessSync(path, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

const onPath = (name) => executable((envValue("PATH") ?? "").split(delimiter).filter(Boolean).map((dir) => join(dir, name)));

function shells() {
  if (!windows) return [
    { name: "sh", file: onPath("sh"), args: (cmd) => ["-c", cmd], required: true },
    { name: "bash", file: onPath("bash"), args: (cmd) => ["-c", cmd] },
  ];
  const programFiles = envValue("ProgramFiles") ?? "C:\\Program Files";
  const systemRoot = envValue("SystemRoot") ?? "C:\\Windows";
  return [
    // PATH can name WSL's bash, which is not the shell Claude Code uses.
    { name: "Git Bash", file: executable([join(programFiles, "Git", "bin", "bash.exe")]), args: (cmd) => ["-c", cmd], required: true },
    { name: "Windows PowerShell", file: executable([join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")]), args: (cmd) => ["-NoProfile", "-Command", cmd], required: true },
    { name: "pwsh", file: onPath("pwsh.exe"), args: (cmd) => ["-NoProfile", "-Command", cmd] },
    // /s strips these outer quotes; verbatim arguments leave the installed command intact.
    { name: "cmd", file: executable([join(systemRoot, "System32", "cmd.exe")]), args: (cmd) => ["/d", "/s", "/c", `"${cmd}"`], required: true, verbatim: true },
  ];
}

function run(file, args, { env, cwd, input = "", timeout = CHILD_TIMEOUT_MS, signal, verbatim = false }) {
  return new Promise((resolve) => {
    const started = performance.now();
    const child = spawn(file, args, { env, cwd, timeout, signal, killSignal: "SIGKILL", windowsHide: true, windowsVerbatimArguments: verbatim });
    let stdout = "";
    let stderr = "";
    let error;
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("error", (err) => { error = err; });
    child.stdin.on("error", (err) => { error = err; });
    child.on("close", (code, exitSignal) => resolve({ code, signal: exitSignal, stdout, stderr, error, ms: performance.now() - started, timeoutMs: timeout }));
    child.stdin.end(input);
  });
}

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const logRows = (file) => existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];

function diagnostics(t, shell, command, result, logFile) {
  t.diagnostic(`shell: ${shell}\ncommand: ${command}\nelapsed: ${result.ms.toFixed(0)} ms, timeout limit: ${result.timeoutMs} ms\nexit: ${result.code}, signal: ${result.signal}, error: ${result.error ?? "none"}\nstdout: ${result.stdout}\nstderr: ${result.stderr}\nlast log rows:\n${existsSync(logFile) ? readFileSync(logFile, "utf8").trim().split("\n").slice(-8).join("\n") : "(no log file)"}`);
}

function assertExit(result) {
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null, `child terminated after ${result.ms.toFixed(0)} ms (timeout limit: ${result.timeoutMs} ms)`);
  assert.equal(result.code, 0);
}

test("e2e: installed hooks work through the harness shells", { timeout: TEST_TIMEOUT_MS }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "jevis hooks e2e-"));
  const home = join(root, "home with spaces");
  const wiki = join(root, "lesson wiki");
  const cwd = join(root, "workspace");
  const logFile = join(home, ".jevis", "log.jsonl");
  for (const dir of [home, wiki, cwd]) mkdirSync(dir);
  // Personal settings and keys must not turn an isolated test off or redirect its server.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("JEVIS_") && !["TYPESAFE_API_KEY", "HOME", "USERPROFILE", "BASH_ENV", "ENV"].includes(key.toUpperCase())));
  Object.assign(env, { HOME: home, USERPROFILE: home });
  const requests = [];
  const serverErrors = [];
  const ids = new Set(["prompt", "tool", "stop"]);
  const server = createServer(async (req, res) => {
    try {
      assert.equal(req.method, "POST");
      assert.equal(req.url, "/v1/systemone");
      assert.equal(req.headers.authorization, undefined);
      let text = "";
      for await (const chunk of req) text += chunk;
      const body = JSON.parse(text);
      assert.ok(body.state && typeof body.state === "object");
      assert.ok(body.questions && typeof body.questions === "object" && !Array.isArray(body.questions));
      requests.push(body);
      const answers = Object.fromEntries(Object.keys(body.questions).map((id) => [id, { type: "noul", noul: id.endsWith("#unless") ? 0.02 : ids.has(id) ? 0.95 : 0.5 }]));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ answers }));
    } catch (error) {
      serverErrors.push(String(error));
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(error) }));
    }
  });
  t.after(async () => {
    await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
    rmSync(root, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const url = `http://127.0.0.1:${server.address().port}/v1/systemone`;
  const options = { env, cwd, signal: t.signal };
  const installed = await run(process.execPath, [installer, "--jev-url", url], options);
  try {
    assertExit(installed);
  } catch (error) {
    diagnostics(t, "node installer", `${installer} --jev-url ${url}`, installed, logFile);
    throw error;
  }

  const titles = { prompt: "Installed prompt lesson", tool: "Installed tool refusal", stop: "Installed stop check" };
  const lessons = {
    prompt: ["ask: Does `request` ask to update the fixture?", "action: context"],
    tool: ["tools: [Bash]", "ask: Does `input` run fixture-delete?", "unless: Does `request` explicitly ask to run fixture-delete?", "when: { marks.plain_read: false }", "action: deny"],
    stop: ["ask: Does `final_message` claim the fixture is finished?", "unless: Does `request` explicitly ask to skip checking the fixture?", "action: block"],
  };
  for (const [event, fields] of Object.entries(lessons)) writeFileSync(join(wiki, `${event}.md`), ["---", `event: ${event}`, ...fields, "min: 0.85", `title: ${titles[event]}`, "source: installed hook shell regression fixture", "---", "Check the fixture before proceeding so unfinished work does not reach the user.", ""].join("\n"));
  const configFile = join(home, ".jevis", "config.json");
  const settings = readJson(configFile);
  assert.equal(settings.JEVIS_JEV_URL, url);
  writeFileSync(configFile, `${JSON.stringify({ ...settings, JEVIS_WIKI: wiki }, null, 2)}\n`);
  const lint = await run(process.execPath, [cli, "lint"], options);
  try {
    assertExit(lint);
    assert.match(lint.stdout, /3 entries/);
  } catch (error) {
    diagnostics(t, "node lint", `${cli} lint`, lint, logFile);
    throw error;
  }

  const configs = {
    claude: readJson(join(home, ".claude", "settings.json")),
    codex: readJson(join(home, ".codex", "hooks.json")),
  };
  const events = { UserPromptSubmit: "prompt", PreToolUse: "tool", Stop: "stop", SessionStart: "session", PostCompact: "session" };
  for (const [harness, config] of Object.entries(configs)) assert.deepEqual(Object.keys(config.hooks).sort(), Object.keys(events).filter((event) => harness === "codex" || event !== "PostCompact").sort());

  for (const shell of shells()) {
    const required = shell.required && envValue("CI")?.toLowerCase() === "true";
    await t.test(shell.name, { skip: !shell.file && !required ? `${shell.name} is not installed; not required for this run` : false }, async (s) => {
      assert.ok(shell.file, `${shell.name} is required on ${process.platform} under CI=true`);
      for (const [harness, config] of Object.entries(configs)) for (const [event, groups] of Object.entries(config.hooks)) {
        const hooks = groups.flatMap((group) => group.hooks);
        assert.ok(hooks.length, `${harness} ${event} must install a hook`);
        for (const [index, hook] of hooks.entries()) await s.test(`${harness} ${event} ${index + 1}`, async (h) => {
          assert.equal(hook.type, "command");
          assert.ok(typeof hook.command === "string" && hook.command.length);
          assert.ok(Number.isFinite(hook.timeout) && hook.timeout > 0);
          const sessionId = randomUUID();
          const kind = events[event];
          const payload = {
            prompt: { prompt: "Update the fixture." },
            tool: { tool_name: "Bash", tool_input: { command: "fixture-delete --all" } },
            stop: { last_assistant_message: "The fixture is finished." },
            session: event === "SessionStart" ? { source: "startup" } : {},
          };
          const input = { session_id: sessionId, cwd, hook_event_name: event, ...(harness === "codex" ? { model: "gpt-test" } : { permission_mode: "default" }), ...payload[kind] };
          const before = requests.length;
          // Reserve part of the harness deadline for shutdown, including a cold Windows shell.
          const timeoutMs = Math.min(CHILD_TIMEOUT_MS, hook.timeout * 1000 * 0.9);
          const result = await run(shell.file, shell.args(hook.command), { ...options, input: `${JSON.stringify(input)}\n`, timeout: timeoutMs, verbatim: shell.verbatim });
          try {
            assertExit(result);
            assert.ok(result.ms < hook.timeout * 1000, `hook exceeded its ${hook.timeout}s timeout`);
            if (kind === "session") {
              assert.equal(result.stdout, "");
              assert.ok(existsSync(join(home, ".jevis", "sessions", `${sessionId}.json`)), "session hook must save its session");
            } else {
              const output = JSON.parse(result.stdout);
              if (kind === "prompt") assert.ok(output.hookSpecificOutput?.additionalContext?.includes(titles.prompt));
              if (kind === "tool") {
                assert.equal(output.hookSpecificOutput?.permissionDecision, "deny");
                assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes(titles.tool));
              }
              if (kind === "stop") {
                assert.equal(output.decision, "block");
                assert.ok(output.reason.includes(titles.stop));
              }
              assert.ok(requests.slice(before).some((body) => kind in body.questions), "installed hook must reach the configured stub");
              assert.ok(logRows(logFile).some((row) => row.sessionId === sessionId && row.event === kind && row.harness === (harness === "codex" ? "Codex" : "Claude Code")), "hook must recognize the harness input");
            }
            assert.ok(existsSync(logFile), "hooks must write the fake home's log");
            assert.deepEqual(logRows(logFile).filter((row) => row.event === "hook-error"), []);
            assert.deepEqual(serverErrors, []);
          } catch (error) {
            diagnostics(h, `${shell.name} (${shell.file}), ${harness} ${event}`, hook.command, result, logFile);
            throw error;
          }
        });
      }
    });
  }
  assert.ok(existsSync(logFile));
  assert.deepEqual(logRows(logFile).filter((row) => row.event === "hook-error"), []);
  assert.deepEqual(serverErrors, []);
});
