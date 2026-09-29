import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hookCommand, jevisHooks, windowsShortPath, word } from "../bin/install.mjs";
import { absolutePaths } from "../src/config.mjs";
import { hookCheck, wikiChecks } from "../src/doctor.mjs";
import { isQualifiedPath } from "../src/paths.mjs";
import { projectContains, wikiRoots } from "../src/wiki.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const installer = join(root, "bin", "install.mjs");
const temp = () => realpathSync(mkdtempSync(join(tmpdir(), "jevis-round2-")));
process.env.JEVIS_HOME = temp();
for (const key of ["JEVIS_WIKI", "JEVIS_DISABLE", "JEVIS_SCOPE"]) delete process.env[key];

const envFor = (home) => {
  const env = { ...process.env, HOME: home, USERPROFILE: home, JEVIS_HOME: join(home, ".jevis"), JEVIS_CRITIC: "off" };
  for (const key of ["JEVIS_DISABLE", "JEVIS_SCOPE", "JEVIS_MODE", "JEVIS_WIKI", "JEVIS_JEV"]) delete env[key];
  return env;
};

test("Stop save failure fails open before returning a block", () => {
  const home = temp();
  const env = envFor(home);
  const sessions = join(env.JEVIS_HOME, "sessions");
  // A directory at the target prevents replacement on every platform, without relying on POSIX modes.
  mkdirSync(join(sessions, "cannot-save.json"), { recursive: true });
  const wiki = join(home, "wiki");
  mkdirSync(wiki);
  writeFileSync(join(wiki, "stop.md"), "---\nevent: stop\nask: Does `final_message` say done?\naction: block\ntitle: Check before done\nsource: test\n---\nVerify the result.\n");
  const preload = join(home, "transport.mjs");
  writeFileSync(preload, `import { setJevTransport } from ${JSON.stringify(new URL("../src/jev.mjs", import.meta.url).href)};\nsetJevTransport(async body => ({ answers: Object.fromEntries(Object.keys(body.questions).map(key => [key, { type: "noul", noul: 0.99 }])) }));\n`);
  const input = JSON.stringify({ session_id: "cannot-save", cwd: home, last_assistant_message: "Done." });
  const result = spawnSync(process.execPath, ["--import", pathToFileURL(preload).href, join(root, "bin", "jevis.mjs"), "hook", "stop"], { env: { ...env, JEVIS_WIKI: wiki }, input, encoding: "utf8", timeout: 10000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "", "the unpersisted block must never reach the harness");
  const rows = readFileSync(join(env.JEVIS_HOME, "log.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(rows.find((row) => row.event === "stop").acted, ["stop"], "the decision really selected a block");
  assert.ok(rows.some((row) => row.event === "hook-error" && row.hook === "stop"));
  assert.deepEqual(readdirSync(sessions), ["cannot-save.json"], "failed temporary writes are cleaned up");
});

test("hook words quote metacharacters and refuse expansions on both platforms", () => {
  const metacharacters = ["&", ";", "|", "<", ">", "(", ")", "^", "'", " ", "😀"];
  const forbidden = ["%", "$", "`", '"', "!", "\n", "\r", "\t", "\0", "\u007f", "\u0085"];
  for (const platform of ["darwin", "linux", "win32"]) {
    const prefix = platform === "win32" ? "C:/Jevis" : "/Jevis";
    assert.equal(word(`${prefix}/漢字ЖΔ१२._-:+@,~=`, platform), `${prefix}/漢字ЖΔ१२._-:+@,~=`);
    for (const character of metacharacters) {
      const cli = `${prefix}/a${character}b/bin/jevis.mjs`;
      assert.equal(word(cli, platform), `"${cli}"`);
      assert.equal(hookCommand("stop", { platform, execPath: platform === "win32" ? "C:/node/node.exe" : "/bin/node", cli }), `${platform === "win32" ? "C:/node/node.exe" : "/bin/node"} "${cli}" hook stop`);
    }
    for (const character of forbidden) {
      const path = `${prefix}/a${character}b`;
      for (const options of [{ execPath: path, cli: `${prefix}/bin/jevis.mjs` }, { execPath: "node", cli: path }]) {
        assert.throws(() => hookCommand("stop", { platform, shortPath: () => assert.fail("refused paths must not enter cmd"), ...options }), (error) => error.message.includes(JSON.stringify(path)) && error.message.includes("unsupported characters") && error.message.includes("U+"));
      }
    }
  }
  assert.equal(word("C:\\Node\\node.exe", "win32"), "C:/Node/node.exe");
  assert.throws(() => word("/tmp/a\\b", "darwin"), /unsupported characters/);
  assert.equal(hookCommand("stop", { platform: "linux", execPath: "/node & path/node", cli: "/repo/bin/jevis.mjs" }), '"/node & path/node" /repo/bin/jevis.mjs hook stop');
});

test("installer refusal precedes all writes, including dry runs", () => {
  const home = temp();
  const env = envFor(home);
  mkdirSync(join(home, ".claude"));
  mkdirSync(env.JEVIS_HOME);
  const settings = join(home, ".claude", "settings.json");
  const config = join(env.JEVIS_HOME, "config.json");
  const original = '{"env":{"KEEP":"unchanged"}}\n';
  writeFileSync(settings, original);
  writeFileSync(config, "{}\n");
  const badHome = join(home, "home$bad");
  mkdirSync(badHome);
  writeFileSync(join(badHome, "config.json"), "{}\n");
  const checkout = join(home, "checkout$bad");
  cpSync(join(root, "bin"), join(checkout, "bin"), { recursive: true });
  cpSync(join(root, "src"), join(checkout, "src"), { recursive: true });
  for (const dry of [false, true]) {
    for (const [file, childEnv, path] of [[join(checkout, "bin", "install.mjs"), env, join(checkout, "bin", "jevis.mjs")]]) {
      const result = spawnSync(process.execPath, [file, "--harness", "claude", "--shadow", ...(dry ? ["--dry-run"] : [])], { env: childEnv, encoding: "utf8", timeout: 10000 });
      assert.notEqual(result.status, 0);
      assert.ok(result.stderr.includes(JSON.stringify(path)));
      assert.match(result.stderr, /unsupported characters.*\$/);
      assert.equal(readFileSync(settings, "utf8"), original);
      assert.equal(readFileSync(config, "utf8"), "{}\n");
      assert.equal(readFileSync(join(badHome, "config.json"), "utf8"), "{}\n");
      assert.equal(existsSync(join(env.JEVIS_HOME, "backups")), false);
      assert.equal(existsSync(join(badHome, "backups")), false);
    }
  }
  // JEVIS_HOME never appears in a hook command, so a $ there is fine.
  const ok = spawnSync(process.execPath, [installer, "--harness", "claude", "--dry-run"], { env: { ...env, JEVIS_HOME: badHome }, encoding: "utf8", timeout: 10000 });
  assert.equal(ok.status, 0, ok.stderr);
});

test("Windows short Node paths precede bare-node fallback", () => {
  const execPath = "C:\\Program Files\\nodejs\\node.exe";
  const cli = "C:\\Jevis & lessons\\bin\\jevis.mjs";
  const short = "C:\\PROGRA~1\\nodejs\\node.exe";
  assert.equal(hookCommand("stop", { platform: "win32", execPath, cli, shortPath: (path) => { assert.equal(path, execPath); return short; } }), 'C:/PROGRA~1/nodejs/node.exe "C:/Jevis & lessons/bin/jevis.mjs" hook stop');
  for (const result of [null, execPath, "node", "C:/No short name/node.exe", "C:/Node&tools/node.exe"]) {
    assert.equal(hookCommand("stop", { platform: "win32", execPath, cli, shortPath: () => result }), 'node "C:/Jevis & lessons/bin/jevis.mjs" hook stop');
  }
  let calls = 0;
  const hooks = jevisHooks("codex", { platform: "win32", execPath, cli, shortPath: () => { calls++; return short; } });
  assert.equal(calls, 1, "each harness resolves Node only once");
  assert.ok(Object.values(hooks).every((groups) => groups[0].hooks[0].command.startsWith("C:/PROGRA~1/")));
  const options = {
    platform: "win32", comspec: "C:/Windows/System32/cmd.exe", exists: (path) => path === short,
    exec: (cmd, args, opts) => {
      assert.equal(cmd, "C:/Windows/System32/cmd.exe");
      assert.deepEqual(args, ["/d", "/s", "/v:off", "/c", `"for %I in ("${execPath}") do @echo "%~sI""`]);
      assert.equal(opts.windowsVerbatimArguments, true);
      return `"${short}"\r\n`;
    },
  };
  assert.equal(windowsShortPath(execPath, options), "C:/PROGRA~1/nodejs/node.exe");
  assert.equal(windowsShortPath(execPath, { ...options, exec: () => `${execPath}\r\n` }), null);
  assert.equal(windowsShortPath(execPath, { ...options, exists: () => false }), null);
  assert.equal(windowsShortPath(execPath, { ...options, exec: () => { throw new Error("8.3 unavailable"); } }), null);
  assert.throws(() => windowsShortPath("C:/Node$bad/node.exe", { ...options, exec: () => assert.fail("bad paths must be refused before cmd") }), /unsupported characters/);
});

test("doctor warns about current-folder Node hijacking only on Windows", () => {
  const home = temp();
  const cli = join(home, "bin", "jevis.mjs");
  mkdirSync(join(home, "bin"));
  writeFileSync(cli, "");
  writeFileSync(join(home, "node.exe"), "");
  const file = join(home, "hooks.json");
  const path = process.env.PATH;
  try {
    process.env.PATH = home;
    for (const node of ["node", "node.exe"]) {
      writeFileSync(file, JSON.stringify({ hooks: jevisHooks("codex", { platform: "win32", execPath: node, cli }) }));
      const result = hookCheck("codex", file, { platform: "win32", cli });
      assert.equal(result.status, "warn");
      assert.match(result.detail, /node.exe from the current folder under cmd/);
      assert.match(result.fix, /install Node in a folder without spaces, or enable 8.3 names/);
      assert.equal(hookCheck("codex", file, { platform: "linux", cli }).status, "ok");
    }
    writeFileSync(file, JSON.stringify({ hooks: jevisHooks("codex", { execPath: process.execPath, cli, platform: process.platform }) }));
    const result = hookCheck("codex", file, { cli });
    assert.equal(result.detail.includes("current folder under cmd"), process.platform === "win32" && /^node /.test(JSON.parse(readFileSync(file, "utf8")).hooks.Stop[0].hooks[0].command));
  } finally { process.env.PATH = path; }
});

test("project realpath containment preserves case", () => {
  assert.equal(projectContains("C:\\work\\Repo\\.jevis\\wiki", "C:\\work\\Repo", "\\"), true);
  assert.equal(projectContains("C:\\work\\repo\\.jevis\\wiki", "C:\\work\\Repo", "\\"), false);
  assert.equal(projectContains("C:\\work\\Repository\\.jevis\\wiki", "C:\\work\\Repo", "\\"), false);
  assert.equal(projectContains("C:\\work\\Repo", "C:\\work\\Repo", "\\"), false);
  assert.equal(projectContains("/private/tmp/Repo/.jevis/wiki", "/private/tmp/Repo", "/"), true);
  assert.equal(projectContains("/private/tmp/repo/.jevis/wiki", "/private/tmp/Repo", "/"), false);
});

test("Windows wiki roots require a drive or UNC share", () => {
  const valid = ["C:\\wiki", "D:/wiki", "\\\\server\\share", "\\\\server\\share\\wiki", "//server/share/wiki"];
  const invalid = ["\\wiki", "/wiki", "C:wiki", "wiki", "\\\\server", "//server"];
  for (const path of valid) {
    assert.equal(isQualifiedPath(path, "win32"), true);
    assert.equal(absolutePaths(path, "win32"), true);
  }
  for (const path of invalid) {
    assert.equal(isQualifiedPath(path, "win32"), false);
    assert.equal(absolutePaths(path, "win32"), false);
  }
  const value = [...valid, ...invalid].join(";");
  assert.equal(absolutePaths(value, "win32"), false);
  assert.deepEqual(wikiRoots(null, { platform: "win32", env: { JEVIS_WIKI: value } }), valid);
  assert.deepEqual(wikiRoots(null, { platform: "win32", env: { JEVIS_WIKI: invalid.join(";") } }), []);
  const warning = wikiChecks(temp(), { JEVIS_WIKI: value }, { platform: "win32" }).find((row) => /not absolute are ignored/.test(row.detail));
  assert.equal(warning.status, "warn");
  assert.ok(warning.detail.endsWith(invalid.join(", ")));
  assert.equal(absolutePaths("/wiki:/other", "linux"), true);
  assert.deepEqual(wikiRoots(null, { platform: "linux", env: { JEVIS_WIKI: "/wiki:/other:relative" } }), ["/wiki", "/other"]);
});

test("Windows short-name lookup runs cmd and returns an existing executable", { skip: process.platform !== "win32" && "Windows short names require cmd.exe" }, () => {
  const executable = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe");
  const result = windowsShortPath(executable);
  assert.equal(typeof result, "string");
  assert.equal(word(result, "win32"), result);
  assert.equal(realpathSync.native(result), realpathSync.native(executable));
  const dir = join(temp(), "Node with spaces");
  mkdirSync(dir);
  const node = join(dir, "node.exe");
  writeFileSync(node, "short-name fixture");
  const alias = windowsShortPath(node);
  // NTFS can disable 8.3 names. If an alias exists, it must resolve to this exact file.
  if (alias !== null) {
    assert.equal(word(alias, "win32"), alias);
    assert.equal(readFileSync(alias, "utf8"), "short-name fixture");
    assert.equal(realpathSync.native(alias), realpathSync.native(node));
  }
});
