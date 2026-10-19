import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { jevisHooks } from "../bin/install.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const json = (file) => JSON.parse(readFileSync(file, "utf8"));
const manifest = json(join(root, "plugin.json"));
const hooks = json(join(root, "hooks/hooks.json")).hooks;

test("plugin: identity, marketplace, skill, and hooks match the existing runtime", () => {
  assert.equal(manifest.$schema, "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
  assert.equal(manifest.name, "jevis");
  assert.equal(manifest.version, json(join(root, "package.json")).version);
  assert.equal(manifest.extensions["com.openai"].hooks, "./hooks/hooks.json");
  assert.ok(existsSync(join(root, "skills/jevis/SKILL.md")));
  const marketplace = json(join(root, ".agents/plugins/marketplace.json"));
  assert.equal(marketplace.plugins[0].name, manifest.name);
  assert.deepEqual(marketplace.plugins[0].source, { source: "local", path: "./" });
  const expected = jevisHooks("codex", { execPath: "node", cli: "/plugin root/bin/jevis.mjs", platform: "linux" });
  for (const groups of Object.values(expected)) for (const group of groups) for (const hook of group.hooks) {
    hook.command = hook.command.replace("/plugin root", "${PLUGIN_ROOT}");
  }
  assert.deepEqual(hooks, expected, "event names, handlers, matcher, and timeouts must stay canonical");
});

test("plugin: package contains a runnable source, excludes local state, and refuses overwrite", (t) => {
  const scratch = mkdtempSync(join(tmpdir(), "jevis plugin package-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const out = join(scratch, "plugin with spaces");
  const builder = join(root, "bin/package-plugin.mjs");
  execFileSync(process.execPath, [builder, "--out", out]);
  for (const file of ["plugin.json", "hooks/hooks.json", "skills/jevis/SKILL.md", "src/hooks.mjs", "bin/jevis.mjs", "bin/install.mjs", "package-lock.json", "WIKI.md", ".agents/plugins/marketplace.json"]) assert.ok(existsSync(join(out, file)), file);
  for (const file of [".git", ".jevis", "node_modules", "eval", "tests", "docs", ".agents/skills"]) assert.equal(existsSync(join(out, file)), false, file);
  const readme = readFileSync(join(out, "README.md"), "utf8");
  assert.equal(readme.includes('src="docs/media/'), false);
  assert.equal(readme.includes("](docs/media/"), false);
  assert.equal(readme.includes("](CONTRIBUTING.md)"), false);
  const home = join(scratch, "state");
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^JEVIS_|^TYPESAFE_API_KEY$/i.test(key)));
  Object.assign(env, { JEVIS_HOME: home, JEVIS_DISABLE: "1" });
  const output = execFileSync(process.execPath, [join(out, "bin/jevis.mjs"), "hook", "prompt"], { env, input: JSON.stringify({ session_id: "package", cwd: scratch, prompt: "Inspect the fictional fixture." }), encoding: "utf8" });
  assert.equal(output, "");
  assert.equal(existsSync(home), false, "a disabled packaged prompt hook must not create state");
  assert.throws(() => execFileSync(process.execPath, [builder, "--out", out], { stdio: "pipe" }), /Output already exists/);
});

test("plugin: bundled hooks run from a spaced installed path with isolated state", { skip: process.platform === "win32" ? "Native plugin Windows shell support is not claimed" : false, timeout: 15000 }, async (t) => {
  const scratch = mkdtempSync(join(tmpdir(), "jevis plugin hooks-"));
  const installed = join(scratch, "installed plugin");
  execFileSync(process.execPath, [join(root, "bin/package-plugin.mjs"), "--out", installed]);
  const wiki = join(scratch, "wiki");
  mkdirSync(wiki);
  const fields = {
    prompt: "action: context\nask: Does `request` ask about the fixture?",
    tool: "action: context\ntools: [Bash]\nwhen: { marks.plain_read: false }\nask: Does `input` delete the fixture?\nunless: Does `request` explicitly authorize deletion?",
    stop: "action: block\nask: Does `final_message` claim success?\nunless: Does `request` ask to skip verification?",
  };
  for (const [event, extra] of Object.entries(fields)) writeFileSync(join(wiki, `${event}.md`), `---\nevent: ${event}\n${extra}\nmin: 0.85\ntitle: Plugin ${event} fixture\nsource: offline plugin test\n---\nCheck the fictional fixture.\n`);
  const requests = [];
  const server = createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    const body = JSON.parse(text);
    requests.push(body);
    const answers = Object.fromEntries(Object.keys(body.questions).map((id) => [id, { type: "noul", noul: id.endsWith("#unless") ? 0.02 : fields[id] ? 0.95 : 0.5 }]));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ answers }));
  });
  t.after(async () => {
    await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
    rmSync(scratch, { recursive: true, force: true });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^JEVIS_|^TYPESAFE_API_KEY$|^BASH_ENV$|^ENV$/i.test(key)));
  Object.assign(env, { PLUGIN_ROOT: installed, JEVIS_HOME: join(scratch, "state"), JEVIS_WIKI: wiki, JEVIS_JEV_URL: `http://127.0.0.1:${server.address().port}/v1/systemone`, JEVIS_CRITIC: "off", JEVIS_RECORD: "off" });
  const events = { SessionStart: { source: "startup" }, UserPromptSubmit: { prompt: "Inspect the fixture." }, PreToolUse: { tool_name: "Bash", tool_input: { command: "fixture-delete --all" } }, PostToolUse: { tool_name: "Bash", tool_input: { command: "npm test" }, tool_response: { exit_code: 1 } }, Stop: { last_assistant_message: "Fixture finished." }, PostCompact: {} };
  for (const [event, payload] of Object.entries(events)) {
    const hook = hooks[event][0].hooks[0];
    const before = requests.length;
    const output = await new Promise((resolve, reject) => {
      const child = spawn("/bin/sh", ["-c", hook.command], { env, cwd: scratch, timeout: 4000 });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", reject);
      child.on("close", (code, signal) => code === 0 && !signal ? resolve(stdout) : reject(new Error(`${event}: ${code}, ${signal}, ${stderr}`)));
      child.stdin.end(JSON.stringify({ session_id: "plugin-fixture", model: "gpt-test", cwd: scratch, hook_event_name: event, ...payload }));
    });
    if (event === "PreToolUse") assert.match(JSON.parse(output).hookSpecificOutput.additionalContext, /Plugin tool fixture/);
    else {
      assert.equal(output, "");
      assert.equal(requests.length, before, "only the tool hook calls the decision model");
    }
    if (event === "UserPromptSubmit") {
      const session = json(join(scratch, "state/sessions/plugin-fixture.json"));
      assert.equal(session.turn, 1);
      assert.equal(session.request, "Inspect the fixture.");
      assert.deepEqual(session.earlierRequests, []);
    }
  }
  assert.ok(existsSync(join(scratch, "state/sessions/plugin-fixture.json")));
  const rows = readFileSync(join(scratch, "state/log.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(rows.some((row) => row.event === "hook-error"), false);
});
