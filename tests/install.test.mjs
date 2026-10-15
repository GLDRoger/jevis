import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const { plan, jevisHooks, nodeIn, reviewStatus, settingsChanges, carriedSettings } = await import("../bin/install.mjs");

const OLD = "/home/u/.local/bin/node /home/u/old/jevis/bin/jevis.mjs hook";
const userSettings = () => ({
  model: "opus",
  permissions: { defaultMode: "auto" },
  hooks: {
    UserPromptSubmit: [{ hooks: [{ type: "command", command: `${OLD} prompt` }] }],
    PostToolUse: [{ hooks: [{ type: "command", command: "prettier --write" }] }],
    PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: `${OLD} tool` }, { type: "command", command: "audit-bash" }] }],
    Notification: [{ matcher: "", hooks: [{ type: "command", command: "say done" }] }],
  },
});

test("install: an earlier Jevis install is replaced, and everything else is kept", () => {
  const { config, removed } = plan(userSettings(), "claude", { node: "/n", cli: "/j/bin/jevis.mjs" });
  assert.equal(removed.length, 2);
  assert.equal(config.model, "opus");
  assert.deepEqual(config.permissions, { defaultMode: "auto" });
  assert.deepEqual(config.hooks.Notification, [{ matcher: "", hooks: [{ type: "command", command: "say done" }] }]);
  assert.deepEqual(config.hooks.PostToolUse[0], { hooks: [{ type: "command", command: "prettier --write" }] });
  assert.match(config.hooks.PostToolUse.at(-1).hooks[0].command, /hook post$/);
  assert.ok(config.hooks.PostToolUseFailure);
  assert.ok(config.hooks.PostCompact);
  assert.deepEqual(config.hooks.PreToolUse[0], { matcher: "Bash", hooks: [{ type: "command", command: "audit-bash" }] }, "a group shared with Jevis keeps its other hooks");
  assert.equal(config.hooks.UserPromptSubmit.at(-1).hooks[0].command, "/n /j/bin/jevis.mjs hook prompt");
  assert.equal(config.hooks.Stop.at(-1).hooks[0].timeout, 420);
  assert.match(config.hooks.PreToolUse.at(-1).matcher, /Bash\|Edit\|Write/);
  assert.equal(JSON.stringify(config).includes("/old/jevis/"), false);
});

test("install: running it twice gives the same config, and the hook commands carry no settings", () => {
  const once = plan(userSettings(), "codex", { node: "/n", cli: "/j/bin/jevis.mjs" }).config;
  assert.deepEqual(plan(once, "codex", { node: "/n", cli: "/j/bin/jevis.mjs" }).config, once);
  assert.ok(once.hooks.PostCompact, "Codex also refreshes notes after compaction");
  assert.equal(once.hooks.PreToolUse.at(-1).matcher, jevisHooks("claude").PreToolUse[0].matcher, "Codex supports the same matcher and aliases apply_patch to Edit/Write");
  assert.equal(jevisHooks("claude", { node: "/n", cli: "/j/bin/jevis.mjs" }).Stop[0].hooks[0].command, "/n /j/bin/jevis.mjs hook stop");
  // Without a short Node name, Windows falls back to node and still recognizes the install.
  const win = jevisHooks("codex", { platform: "win32", shortPath: () => null, node: "C:\\Program Files\\nodejs\\node.exe", cli: "C:\\Users\\me\\jevis\\bin\\jevis.mjs" });
  assert.equal(win.Stop[0].hooks[0].command, 'node C:/Users/me/jevis/bin/jevis.mjs hook stop');
  assert.equal(plan({ hooks: win }, "codex", { uninstall: true }).removed.length, Object.keys(win).length);
});

test("install: options are saved as settings, kept across installs, and older command prefixes carry over", () => {
  assert.deepEqual(settingsChanges({ decider: "luna" }), { JEVIS_DECIDER: "luna" });
  assert.deepEqual(settingsChanges({ decider: "jev" }), { JEVIS_DECIDER: null });
  assert.throws(() => settingsChanges({ decider: "bogus" }), /--decider must be one of jev, luna, got bogus/);
  assert.deepEqual(settingsChanges({ shadow: true, critic: "off", jevUrl: "http://127.0.0.1:8000/v1/systemone" }), { JEVIS_MODE: "shadow", JEVIS_CRITIC: "off", JEVIS_JEV_URL: "http://127.0.0.1:8000/v1/systemone" });
  assert.deepEqual(settingsChanges({}), {}, "an install without options changes no setting");
  assert.deepEqual(settingsChanges({ live: true, critic: "claude", jevUrl: "typesafe" }), { JEVIS_MODE: null, JEVIS_CRITIC: null, JEVIS_JEV_URL: null }, "defaults remove the setting");
  assert.throws(() => settingsChanges({ jevUrl: "http://x/v1; rm -rf ~" }), /plain http\(s\) URL/);
  assert.throws(() => settingsChanges({ critic: "gemini" }), /--critic must be one of/);
  assert.throws(() => settingsChanges({ shadow: true, live: true }), /contradict/);
  const old = { hooks: { Stop: [{ hooks: [{ command: "JEVIS_MODE=shadow JEVIS_JEV_URL=http://127.0.0.1:8000/v1/systemone /n /j/bin/jevis.mjs hook stop" }, { command: "FOO=1 other-hook" }] }] } };
  const carried = carriedSettings(old);
  assert.deepEqual(carried, { JEVIS_MODE: "shadow", JEVIS_JEV_URL: "http://127.0.0.1:8000/v1/systemone" });
  assert.deepEqual(settingsChanges({}, { carried, saved: {} }), carried, "a reinstall keeps what the old commands set");
  assert.deepEqual(settingsChanges({ live: true }, { carried, saved: { JEVIS_JEV_URL: "http://other/v1/systemone" } }), { JEVIS_MODE: null }, "the saved file and this install's options win over old prefixes");
  assert.equal(plan(old, "claude", { node: "/n", cli: "/j/bin/jevis.mjs" }).config.hooks.Stop.at(-1).hooks[0].command, "/n /j/bin/jevis.mjs hook stop");
});

test("install: --critic picks the reviewer or turns the review off, and says whether it can run", () => {
  assert.match(reviewStatus("off"), /off\. Every other check still runs/);
  assert.match(reviewStatus("claude", { chrome: true, cli: true }), /on, reviewed by Claude/);
  assert.match(reviewStatus("codex", { chrome: true, cli: true }), /on, reviewed by Codex/);
  const missing = reviewStatus("claude", { chrome: false, cli: false });
  assert.match(missing, /skipped until Google Chrome and the claude CLI are installed/);
  assert.match(missing, /--critic off, or pick --critic codex/);
  assert.match(reviewStatus("codex", { chrome: true, cli: false }), /skipped until the codex CLI is installed\. .*--critic off\.$/);
});

test("install: Luna dry-run checks OpenAI keys, not TypeSafe keys, without writing", () => {
  const home = mkdtempSync(join(tmpdir(), "jevis-install-luna-"));
  const env = { ...process.env, HOME: home, USERPROFILE: home, JEVIS_HOME: join(home, ".jevis") };
  for (const key of ["JEVIS_DECIDER", "JEVIS_LUNA_KEY", "OPENAI_API_KEY"]) delete env[key];
  env.TYPESAFE_API_KEY = "fake-typesafe-key";
  const run = () => execFileSync(process.execPath, [fileURLToPath(new URL("../bin/install.mjs", import.meta.url)), "--dry-run", "--decider", "luna"], { env, encoding: "utf8" });
  const missing = run();
  assert.match(missing, /No OpenAI key in JEVIS_LUNA_KEY, OPENAI_API_KEY, or ~\/\.jevis\/secrets\/openai_api_key/);
  assert.doesNotMatch(missing, /No TypeSafe key/);
  assert.match(missing, /JEVIS_DECIDER="luna"/);
  assert.match(missing, /Dry run: nothing written/);
  assert.deepEqual(readdirSync(home), []);
  env.OPENAI_API_KEY = "fake-openai-key";
  assert.doesNotMatch(run(), /No OpenAI key|fake-openai-key/);
  assert.deepEqual(readdirSync(home), []);
});

test("uninstall: removes Jevis and leaves the rest, down to an empty hooks key", () => {
  const installed = plan({ hooks: {} }, "claude", { node: "/n", cli: "/j/bin/jevis.mjs" }).config;
  assert.deepEqual(plan(installed, "claude", { uninstall: true }).config, {});
  const mixed = plan(userSettings(), "claude", { node: "/n", cli: "/j/bin/jevis.mjs" }).config;
  const back = plan(mixed, "claude", { uninstall: true }).config;
  assert.deepEqual(Object.keys(back.hooks).sort(), ["Notification", "PostToolUse", "PreToolUse"]);
});

test("install: reuses the node binary an earlier Jevis install runs with", () => {
  const node = process.execPath;
  assert.equal(nodeIn({ hooks: { Stop: [{ hooks: [{ command: `${/\s/.test(node) ? `"${node}"` : node} /u/code/jevis/bin/jevis.mjs hook stop` }] }] } }), node);
  assert.equal(nodeIn({ hooks: { Stop: [{ hooks: [{ command: "/gone/bin/node /u/code/jevis/bin/jevis.mjs hook stop" }] }] } }), null, "a path that no longer exists is not reused");
  assert.equal(nodeIn({}), null);
});

test("install: backups of your settings are private, even when the README's mkdir left ~/.jevis world-readable", () => {
  const home = mkdtempSync(join(tmpdir(), "jevis-install-home-"));
  mkdirSync(join(home, ".claude"));
  writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ env: { ANTHROPIC_API_KEY: "fake" } }), { mode: 0o644 });
  mkdirSync(join(home, ".jevis", "secrets"), { recursive: true, mode: 0o755 });
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.JEVIS_HOME;
  execFileSync(process.execPath, [fileURLToPath(new URL("../bin/install.mjs", import.meta.url)), "--harness", "claude", "--shadow"], { env, stdio: "ignore" });
  const mode = (p) => statSync(p).mode & 0o777;
  const backups = join(home, ".jevis", "backups");
  const stamp = readdirSync(backups)[0];
  assert.deepEqual(JSON.parse(readFileSync(join(backups, stamp, "claude-settings.json"), "utf8")), { env: { ANTHROPIC_API_KEY: "fake" } });
  if (process.platform !== "win32") assert.equal(mode(join(home, ".jevis")), 0o700);
  if (process.platform !== "win32") assert.equal(mode(join(backups, stamp)), 0o700);
  if (process.platform !== "win32") assert.equal(mode(join(backups, stamp, "claude-settings.json")), 0o600);
  // The option went to the private settings file, not onto the hook command.
  if (process.platform !== "win32") assert.equal(mode(join(home, ".jevis", "config.json")), 0o600);
  assert.deepEqual(JSON.parse(readFileSync(join(home, ".jevis", "config.json"), "utf8")), { JEVIS_MODE: "shadow" });
  const settings = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8"));
  assert.doesNotMatch(settings.hooks.Stop[0].hooks[0].command, /JEVIS_MODE/);
  // A second install without options keeps the saved setting.
  execFileSync(process.execPath, [fileURLToPath(new URL("../bin/install.mjs", import.meta.url)), "--harness", "claude"], { env, stdio: "ignore" });
  assert.deepEqual(JSON.parse(readFileSync(join(home, ".jevis", "config.json"), "utf8")), { JEVIS_MODE: "shadow" });
});

test("install: backs up config.json privately before changing options; dry-run writes nothing", () => {
  const home = mkdtempSync(join(tmpdir(), "jevis-config-backup-"));
  const jevis = join(home, ".jevis");
  mkdirSync(jevis);
  const before = { JEVIS_CRITIC: "off", JEVIS_MODE: "shadow" };
  writeFileSync(join(jevis, "config.json"), JSON.stringify(before), { mode: 0o644 });
  const env = { ...process.env, HOME: home, USERPROFILE: home, JEVIS_HOME: jevis };
  const install = fileURLToPath(new URL("../bin/install.mjs", import.meta.url));
  execFileSync(process.execPath, [install, "--harness", "claude", "--live", "--dry-run"], { env, stdio: "ignore" });
  assert.deepEqual(readdirSync(jevis), ["config.json"]);
  execFileSync(process.execPath, [install, "--harness", "claude", "--live"], { env, stdio: "ignore" });
  const backups = join(jevis, "backups");
  const copy = join(backups, readdirSync(backups)[0], "config.json");
  assert.deepEqual(JSON.parse(readFileSync(copy, "utf8")), before);
  assert.deepEqual(JSON.parse(readFileSync(join(jevis, "config.json"), "utf8")), { JEVIS_CRITIC: "off" });
  if (process.platform !== "win32") assert.equal(statSync(copy).mode & 0o777, 0o600);
});
