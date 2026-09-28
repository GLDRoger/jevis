import assert from "node:assert/strict";
import { test } from "node:test";

const { plan, jevisHooks, nodeIn } = await import("../bin/install.mjs");

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

test("install: running it twice gives the same config; shadow mode and a Laya URL are env vars on the command", () => {
  const once = plan(userSettings(), "codex", { node: "/n", cli: "/j/bin/jevis.mjs" }).config;
  assert.deepEqual(plan(once, "codex", { node: "/n", cli: "/j/bin/jevis.mjs" }).config, once);
  assert.ok(once.hooks.PostCompact, "Codex also refreshes notes after compaction");
  assert.equal(once.hooks.PreToolUse.at(-1).matcher, undefined, "Codex hooks see every tool");
  const shadow = jevisHooks("claude", { node: "/n", cli: "/j/bin/jevis.mjs", shadow: true });
  assert.equal(shadow.Stop[0].hooks[0].command, "JEVIS_MODE=shadow /n /j/bin/jevis.mjs hook stop");
  const laya = jevisHooks("codex", { node: "/n", cli: "/j/bin/jevis.mjs", jevUrl: "http://127.0.0.1:8000/v1/systemone" });
  assert.equal(laya.UserPromptSubmit[0].hooks[0].command, "JEVIS_JEV_URL=http://127.0.0.1:8000/v1/systemone /n /j/bin/jevis.mjs hook prompt");
  assert.throws(() => jevisHooks("codex", { jevUrl: "http://x/v1; rm -rf ~" }), /plain http\(s\) URL/, "a URL cannot smuggle a shell command into the hook");
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
  assert.equal(nodeIn({ hooks: { Stop: [{ hooks: [{ command: `${node} /u/code/jevis/bin/jevis.mjs hook stop` }] }] } }), node);
  assert.equal(nodeIn({ hooks: { Stop: [{ hooks: [{ command: "/gone/bin/node /u/code/jevis/bin/jevis.mjs hook stop" }] }] } }), null, "a path that no longer exists is not reused");
  assert.equal(nodeIn({}), null);
});
