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
  assert.deepEqual(config.hooks.PostToolUse, [{ hooks: [{ type: "command", command: "prettier --write" }] }]);
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
  assert.equal(once.hooks.PreToolUse.at(-1).matcher, undefined, "Codex hooks see every tool");
  assert.equal(jevisHooks("claude", { node: "/n", cli: "/j/bin/jevis.mjs" }).Stop[0].hooks[0].command, "/n /j/bin/jevis.mjs hook stop");
  // A path with a space is quoted, and a quoted install is still recognized as Jevis's own.
  const win = jevisHooks("codex", { platform: "darwin", node: "C:\\Program Files\\nodejs\\node.exe", cli: "C:\\Users\\me\\jevis\\bin\\jevis.mjs" });
  assert.equal(win.Stop[0].hooks[0].command, '"C:\\Program Files\\nodejs\\node.exe" C:\\Users\\me\\jevis\\bin\\jevis.mjs hook stop');
  assert.equal(plan({ hooks: win }, "codex", { uninstall: true }).removed.length, Object.keys(win).length);
});

test("install: options are saved as settings, kept across installs, and older command prefixes carry over", () => {
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
