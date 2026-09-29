import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { carriedSettings, commandWords, hookCommand, jevisHooks, nodeIn, onPath, plan } from "../bin/install.mjs";
import { SETTINGS, readConfig } from "../src/config.mjs";
import { patchAdditions, touchedFiles, turnEvidence } from "../src/context.mjs";
import { hookCheck, privacyCheck } from "../src/doctor.mjs";
import { exportDataset } from "../src/export.mjs";
import { inScope } from "../src/hooks.mjs";
import { insideFolder, samePath, splitFolders } from "../src/paths.mjs";
import { criticArgs, criticCommand, projectPorts, renderTargets, run, runCritic } from "../src/review.mjs";
import { loadSession, saveSession } from "../src/state.mjs";
import { eachJsonl, readJsonl } from "../src/transcript.mjs";
import { loadWiki, parseEntry, wikiDigest, wikiRoots } from "../src/wiki.mjs";

process.env.JEVIS_HOME = mkdtempSync(join(tmpdir(), "jevis-xplat-home-"));
for (const k of ["JEVIS_DISABLE", "JEVIS_SCOPE", "JEVIS_WIKI", "JEVIS_CRITIC_MODEL", "JEVIS_DESIGN_LAW"]) delete process.env[k];
const temp = () => mkdtempSync(join(tmpdir(), "jevis-xplat-"));
const configWith = (command) => ({ hooks: { Stop: [{ hooks: [{ command }] }] } });
const LESSON = "---\nevent: prompt\nask: |\n  Does `request` want a page?\n  Or a drawing?\naction: context\ntitle: A lesson\nsource: test\n---\nOne line.\n\nInstead: another line.\n";

test("Windows hook words are shell-neutral, and POSIX commands are unchanged", () => {
  const cli = "C:\\Users\\me\\My Projects\\jevis\\bin\\jevis.mjs";
  assert.equal(hookCommand("stop", { platform: "win32", execPath: "C:\\Program Files\\nodejs\\node.exe", cli, shortPath: () => null }), 'node "C:/Users/me/My Projects/jevis/bin/jevis.mjs" hook stop');
  assert.equal(hookCommand("prompt", { platform: "win32", execPath: "D:\\node\\node.exe", cli: "D:\\jevis\\bin\\jevis.mjs" }), "D:/node/node.exe D:/jevis/bin/jevis.mjs hook prompt");
  for (const platform of ["darwin", "linux"]) assert.equal(hookCommand("tool", { platform, execPath: "/node path/node", cli: "/my project/bin/jevis.mjs" }), '"/node path/node" "/my project/bin/jevis.mjs" hook tool');
  const old = configWith('JEVIS_MODE=shadow "C:\\Program Files\\nodejs\\node.exe" "C:\\Old Project\\BIN\\JEVIS.MJS" hook stop');
  assert.deepEqual(carriedSettings(old, { platform: "win32" }), { JEVIS_MODE: "shadow" });
  assert.equal(nodeIn(old, { platform: "win32", exists: (p) => p === "C:\\Program Files\\nodejs\\node.exe" }), "C:\\Program Files\\nodejs\\node.exe");
  assert.equal(nodeIn(configWith("node C:/old/bin/jevis.mjs hook stop"), { platform: "win32", onPath: (p) => p === "node" }), "node");
  assert.equal(nodeIn(old, { platform: "win32", exists: () => false }), null);
  const opts = { platform: "win32", execPath: "C:\\Program Files\\nodejs\\node.exe", cli, shortPath: () => null };
  const once = plan(old, "codex", opts);
  assert.equal(once.removed.length, 1);
  assert.deepEqual(plan(once.config, "codex", opts).config, once.config);
  assert.deepEqual(plan(old, "codex", { uninstall: true, platform: "win32" }).config, {});
});

test("PATH discovery includes Windows executable and command shims", () => {
  const a = temp();
  const b = temp();
  writeFileSync(join(b, "claude.cmd"), "");
  writeFileSync(join(b, "node.exe"), "");
  assert.equal(onPath("claude", `${a};"${b}"`, "win32"), true);
  assert.equal(onPath("node", b, "win32"), true);
  assert.equal(onPath("node.exe", b, "win32"), true);
  assert.equal(onPath("codex", b, "win32"), false);
});

test("doctor accepts bare node on PATH, an explicit .exe, and quoted script paths", () => {
  const dir = join(temp(), "checkout space", "bin");
  mkdirSync(dir, { recursive: true });
  const cli = join(dir, "jevis.mjs");
  writeFileSync(cli, "");
  const file = join(dir, "hooks.json");
  for (const node of ["node", process.platform === "win32" ? "node.exe" : process.execPath]) {
    writeFileSync(file, JSON.stringify({ hooks: jevisHooks("codex", { node, cli }) }));
    assert.equal(hookCheck("codex", file, { cli }).status, process.platform === "win32" && /^node(?:\.exe)?$/.test(node) ? "warn" : "ok");
  }
  writeFileSync(file, JSON.stringify({ hooks: jevisHooks("codex", { node: "missing-node-for-jevis", cli }) }));
  assert.match(hookCheck("codex", file, { cli }).detail, /node not found/);
});

test("folder lists retain drive letters, use the native delimiter, and write the same env form", () => {
  assert.deepEqual(splitFolders("C:\\app;D:/other;;", ";"), ["C:\\app", "D:/other"]);
  assert.deepEqual(splitFolders("/a:/b", ":"), ["/a", "/b"]);
  const a = temp();
  const b = temp();
  const file = join(a, "config.json");
  writeFileSync(file, JSON.stringify({ JEVIS_SCOPE: [a, b], JEVIS_WIKI: [a, b] }));
  assert.deepEqual(readConfig(file).values, { JEVIS_SCOPE: [a, b].join(delimiter), JEVIS_WIKI: [a, b].join(delimiter) });
  assert.equal(SETTINGS.JEVIS_WIKI.ok([a, b].join(delimiter)), true);
  assert.equal(SETTINGS.JEVIS_WIKI.ok([a, "relative"]), false);
  process.env.JEVIS_WIKI = [a, b].join(delimiter);
  try { assert.deepEqual(wikiRoots(), [a, b]); } finally { delete process.env.JEVIS_WIKI; }
  process.env.JEVIS_SCOPE = [a, b].join(delimiter);
  try {
    assert.equal(inScope(join(b, "nested")), true);
    assert.equal(inScope(`${b}-neighbor`), false);
  } finally { delete process.env.JEVIS_SCOPE; }
});

test("Windows containment handles case, roots, UNC names, and mixed separators", () => {
  assert.equal(insideFolder("c:/PROJECT/App/src", "C:\\project\\app\\", "win32"), true);
  assert.equal(insideFolder("C:\\APP", "c:/app/", "win32"), true);
  assert.equal(insideFolder("C:/application", "C:/app", "win32"), false);
  assert.equal(insideFolder("D:/app", "C:/", "win32"), false);
  assert.equal(insideFolder("C:/app", "c:/", "win32"), true);
  assert.equal(insideFolder("\\\\Server\\Share\\App\\src", "\\\\server\\share\\app", "win32"), true);
  assert.equal(samePath("C:/App", "c:\\app\\", "win32"), true);
  assert.equal(samePath("/App", "/app", "darwin"), false);
  process.env.JEVIS_SCOPE = "C:\\project\\App\\;D:/second";
  try {
    assert.equal(inScope("c:/PROJECT/app", { platform: "win32" }), true);
    assert.equal(inScope("d:\\SECOND\\src", { platform: "win32" }), true);
    assert.equal(inScope("C:/project/application", { platform: "win32" }), false);
  } finally { delete process.env.JEVIS_SCOPE; }
  process.env.JEVIS_SCOPE = "/tmp/app:/second";
  try { assert.equal(inScope("/private/tmp/app/src", { platform: "darwin" }), true); } finally { delete process.env.JEVIS_SCOPE; }
});

test("changed and touched file evidence uses stable slash paths, and excludes test folders", () => {
  const cwd = temp();
  mkdirSync(join(cwd, "tests"));
  mkdirSync(join(cwd, "src"));
  writeFileSync(join(cwd, "tests", "fixture.html"), "");
  writeFileSync(join(cwd, "src", "Page.tsx"), "");
  const root = process.platform === "win32" ? cwd.toUpperCase() : cwd;
  const changes = [join(cwd, "src", "Page.tsx"), join(cwd, "tests", "fixture.html")].map((path) => ({ path }));
  const evidence = turnEvidence([{ it: { type: "FileChange", changes } }], { cwd: root });
  assert.deepEqual(evidence.files_changed, ["src/Page.tsx", "tests/fixture.html"]);
  assert.deepEqual(evidence.ui_files_changed, ["src/Page.tsx"]);
  assert.deepEqual(touchedFiles(cwd, Date.now() - 10_000).sort(), ["src/Page.tsx", "tests/fixture.html"]);
});

test("Windows doctor explains permissions rather than warning about fake mode bits", () => {
  const result = privacyCheck(temp(), "win32");
  assert.equal(result.status, "info");
  assert.match(result.detail, /permissions are not checked on Windows.*user profile/);
});

test("CRLF lessons and patches parse identically, while wiki trust remains byte-exact", () => {
  assert.deepEqual(parseEntry(LESSON.replaceAll("\n", "\r\n"), "team/lesson"), parseEntry(LESSON, "team/lesson"));
  const dir = temp();
  mkdirSync(join(dir, "team"));
  const file = join(dir, "team", "lesson.md");
  writeFileSync(file, LESSON);
  const hash = wikiDigest(dir);
  const lf = loadWiki([dir]);
  writeFileSync(file, LESSON.replaceAll("\n", "\r\n"));
  assert.deepEqual(loadWiki([dir]), lf);
  assert.notEqual(wikiDigest(dir), hash);
  const patch = "*** Update File: src/Page.tsx\n+hello\n+world\n";
  assert.equal(patchAdditions(patch.replaceAll("\n", "\r\n")), patchAdditions(patch));
});

test("CRLF JSONL and questions files do not leak carriage returns to readers or export", () => {
  const home = temp();
  const dir = join(home, "jev");
  mkdirSync(join(dir, "questions"), { recursive: true });
  writeFileSync(join(dir, "questions", "v1.json"), '{\r\n  "q": {"type":"noul", "instructions":"Does `request` ask?"}\r\n}\r\n');
  const row = { event: "prompt", version: "v1", sessionId: "s", state: { request: "hello" }, answers: { q: 0.9 } };
  const calls = join(dir, "calls.jsonl");
  writeFileSync(calls, `${JSON.stringify(row)}\r\n${JSON.stringify(row)}\r`);
  const kept = [];
  eachJsonl(calls, (r) => kept.push(r), { keep: (line) => { assert.doesNotMatch(line, /\r$/); return true; } });
  assert.deepEqual(kept, [row, row]);
  assert.deepEqual(readJsonl(calls), kept);
  const result = exportDataset({ home, out: join(home, "export") });
  assert.equal(result.train + result.test, 1);
  assert.equal(result.duplicates, 1);
});

test("session save retries Windows sharing failures, and keeps the previous file on exhaustion", () => {
  let attempts = 0;
  const waits = [];
  saveSession("retry", { turn: 7 }, {
    platform: "win32", wait: (ms) => waits.push(ms),
    rename: (tmp, file) => {
      if (++attempts <= 2) throw Object.assign(new Error("reader holds target"), { code: attempts === 1 ? "EPERM" : "EBUSY" });
      renameSync(tmp, file);
    },
  });
  assert.equal(loadSession("retry").turn, 7);
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [25, 25]);
  attempts = 0;
  waits.length = 0;
  assert.throws(() => saveSession("retry", { turn: 8 }, { platform: "win32", wait: (ms) => waits.push(ms), rename: () => { attempts++; throw Object.assign(new Error("busy"), { code: "EBUSY" }); } }));
  assert.equal(attempts, 5);
  assert.equal(waits.reduce((a, b) => a + b, 0), 100);
  assert.equal(loadSession("retry").turn, 7);
  assert.equal(readdirSync(join(process.env.JEVIS_HOME, "sessions")).some((f) => f.endsWith(".tmp")), false);
  assert.throws(() => saveSession("retry", { turn: 9 }, { platform: "linux", wait: () => assert.fail("POSIX must not wait"), rename: () => { throw new Error("disk failure"); } }));
  assert.equal(loadSession("retry").turn, 7);
});

test("critic argument builders contain flags and paths only, with quoted Windows shim words", () => {
  const opts = { dir: "C:\\Review & Shots", shots: [{ file: "C:\\Review & Shots\\one.png" }], law: null, model: "test-model" };
  const codex = criticArgs("codex", opts);
  assert.deepEqual(codex, ["exec", "--skip-git-repo-check", "--ephemeral", "-s", "read-only", "-m", "test-model", "-i", opts.shots[0].file, "-"]);
  assert.deepEqual(criticArgs("claude", opts), ["-p", "--allowedTools", "Read", "--add-dir", opts.dir, "--output-format", "text", "--model", "test-model"]);
  const cmd = criticCommand("C:\\Program Files\\codex.cmd", codex, { platform: "win32", comspec: "cmd.exe" });
  assert.equal(cmd.cmd, "cmd.exe");
  assert.deepEqual(cmd.args.slice(0, 4), ["/d", "/s", "/v:off", "/c"]);
  assert.equal(cmd.args[4], `""C:\\Program Files\\codex.cmd" ${codex.map((a) => `"${a}"`).join(" ")}"`);
  assert.equal(cmd.options.windowsVerbatimArguments, true);
  assert.throws(() => criticCommand("codex.cmd", ["%PATH%"], { platform: "win32", path: "" }), /unsupported character/);
  assert.deepEqual(criticCommand("codex", codex, { platform: "darwin" }), { cmd: "codex", args: codex, options: {} });
  assert.deepEqual(commandWords('node "C:/Projects/Review Shots/bin/jevis.mjs" hook stop'), ["node", "C:/Projects/Review Shots/bin/jevis.mjs", "hook", "stop"]);
});

test("critic stdin handoff preserves a long hostile prompt without exposing it to argv or a shell", async () => {
  const prompt = '" & echo SHELL_EXECUTED | $(exit 9) %PATH% `whoami`\r\n' + "雪".repeat(12_000);
  const code = 'let text="";process.stdin.setEncoding("utf8");process.stdin.on("data",d=>text+=d);process.stdin.on("end",()=>process.stdout.write(JSON.stringify({text,args:process.argv.slice(1),disabled:process.env.JEVIS_DISABLE})))';
  const result = await run(process.execPath, ["-e", code, "controlled-flag"], prompt, { timeoutMs: 5000 });
  assert.equal(result.error, undefined);
  assert.deepEqual(JSON.parse(result.text), { text: prompt, args: ["controlled-flag"], disabled: "1" });
  const missing = await run(join(temp(), "no-critic.exe"), [], prompt, { timeoutMs: 5000 });
  assert.ok(missing.error);
});

test("real critic handoff uses stdin for both CLIs, including .cmd shims on Windows", async () => {
  const dir = join(temp(), "critic & space");
  mkdirSync(dir);
  const script = join(dir, "critic.mjs");
  writeFileSync(script, 'let text="";process.stdin.setEncoding("utf8");process.stdin.on("data",d=>text+=d);process.stdin.on("end",()=>process.stdout.write(JSON.stringify({text,args:process.argv.slice(2),disabled:process.env.JEVIS_DISABLE})))');
  for (const cli of ["claude", "codex"]) {
    const file = join(dir, `${cli}${process.platform === "win32" ? ".cmd" : ""}`);
    writeFileSync(file, process.platform === "win32" ? `@echo off\r\n"${process.execPath}" "${script}" %*\r\n` : `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
    if (process.platform !== "win32") chmodSync(file, 0o700);
  }
  const saved = { PATH: process.env.PATH, JEVIS_CRITIC: process.env.JEVIS_CRITIC };
  const prompt = 'prompt " & echo NOT_A_COMMAND | %PATH%\n' + "x".repeat(12_000);
  try {
    process.env.PATH = dir;
    for (const cli of ["claude", "codex"]) {
      process.env.JEVIS_CRITIC = cli;
      const result = await runCritic(prompt, { cwd: dir, dir, shots: [{ file: join(dir, "image & one.png") }], timeoutMs: 5000 });
      assert.equal(result.error, undefined);
      const reply = JSON.parse(result.text);
      assert.equal(reply.text, prompt);
      assert.equal(reply.disabled, "1");
      assert.deepEqual(reply.args, criticArgs(cli, { dir, shots: [{ file: join(dir, "image & one.png") }] }));
      assert.equal(reply.args.includes(prompt), false);
    }
  } finally {
    for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : process.env[k] = v;
  }
});

test("dev server lookup fails quietly without lsof, and Windows falls back to changed HTML", async () => {
  const noLsof = () => { throw Object.assign(new Error("missing lsof"), { code: "ENOENT" }); };
  assert.deepEqual(projectPorts(temp(), { platform: "linux", exec: noLsof }), []);
  assert.deepEqual(projectPorts(temp(), { platform: "win32", exec: () => assert.fail("Windows must not call lsof") }), []);
  const cwd = temp();
  const html = join(cwd, "index.html");
  writeFileSync(html, "<h1>Hello</h1>");
  const path = process.env.PATH;
  try {
    process.env.PATH = "";
    assert.deepEqual(await renderTargets({ cwd, files: ["index.html"] }), [pathToFileURL(html).href]);
  } finally { process.env.PATH = path; }
});

test("Windows critic timeout kills the cmd shim and its child", { skip: process.platform !== "win32" && "cmd.exe process trees exist only on Windows" }, async () => {
  const dir = temp();
  const script = join(dir, "sleep.mjs");
  writeFileSync(script, "setTimeout(() => {}, 30000)");
  const shim = join(dir, "sleep.cmd");
  writeFileSync(shim, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
  const start = Date.now();
  const result = await run(shim, [], "prompt", { cwd: dir, timeoutMs: 500 });
  assert.ok(result.error);
  assert.ok(Date.now() - start < 5000, "the CLI must not keep output pipes open after timeout");
});
