import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { readConfig, SETTINGS } from "../src/config.mjs";
import { isVagueFeedback, onPrompt, onSession, onTool } from "../src/hooks.mjs";
import { setJevTransport } from "../src/jev.mjs";
import { loadNudges, nudgeText } from "../src/nudges.mjs";
import { recordHealth } from "../src/health.mjs";
import { loadSession, readLog } from "../src/state.mjs";

const root = mkdtempSync(join(tmpdir(), "jevis-nudges-"));
const cli = fileURLToPath(new URL("../bin/jevis.mjs", import.meta.url));
after(() => rmSync(root, { recursive: true, force: true }));
let shipped, user, roots, cwd, calls;
beforeEach(() => {
  for (const key of Object.keys(process.env)) if (key.startsWith("JEVIS_")) delete process.env[key];
  cwd = mkdtempSync(join(root, "case-"));
  shipped = join(cwd, "shipped");
  process.env.JEVIS_HOME = join(cwd, "home");
  user = join(process.env.JEVIS_HOME, "nudges");
  process.env.JEVIS_NUDGES_DIR = shipped;
  process.env.JEVIS_WIKI = join(cwd, "wiki");
  process.env.JEVIS_RECORD = "off";
  process.env.JEVIS_CRITIC = "off";
  roots = [shipped, user];
  for (const dir of [...roots, process.env.JEVIS_WIKI]) mkdirSync(dir, { recursive: true });
  calls = [];
  setJevTransport(async ({ questions }) => {
    calls.push(Object.keys(questions));
    return { answers: Object.fromEntries(Object.keys(questions).map((id) => [id, { noul: id.endsWith("#unless") ? 0.01 : 0.99 }])) };
  });
});

const put = (dir, name, headers, body = "A fixed line.") => {
  const file = join(dir, `${name}.md`);
  writeFileSync(file, ["---", headers, "---", body].join("\n"));
  return file;
};
const fixtures = () => {
  put(shipped, "session", "hook: session\nfamily: gpt", "Session context.");
  put(shipped, "prompt", "hook: prompt\nfamily: gpt", "Understand the intent.");
  put(shipped, "ui", "hook: ui-edit\nfamily: gpt", "Avoid default design habits.");
};
const prompt = (session_id, model = "gpt-6.1-sol", text = "Build the requested screen.") => onPrompt({ session_id, cwd, model, prompt: text });
const tool = (session_id, tool_name = "Write", tool_input = { file_path: "src/app/page.tsx", content: "export default () => null;" }, extra = {}) => onTool({ session_id, cwd, tool_name, tool_input, ...extra });
const context = (result) => result?.hookSpecificOutput?.additionalContext;
const nudgeRows = (sessionId) => readLog().filter((r) => r.event === "nudge" && (!sessionId || r.sessionId === sessionId));
function lesson(id, action) {
  return put(process.env.JEVIS_WIKI, id, [
    "event: tool", "tools: [Write]", "ask: Does `input` edit a file?", `action: ${action}`,
    ...(action === "deny" ? ["unless: Did `request` explicitly ask for this?"] : []),
    "title: Fixture lesson", "source: test",
  ].join("\n"), "Existing lesson text.");
}

test("nudges: loads flat Markdown, sorted by id, preserving trimmed body verbatim", () => {
  const file = put(shipped, "z", "hook: prompt\nfamily: 'gpt'", "  First line.\n\nSecond line.  ");
  put(shipped, "a", "hook: session", "All models.");
  mkdirSync(join(shipped, "nested"));
  put(join(shipped, "nested"), "ignored", "hook: prompt");
  writeFileSync(join(shipped, "ignored.txt"), "not a nudge");
  const loaded = loadNudges({ roots });
  assert.deepEqual(loaded.broken, []);
  assert.deepEqual(loaded.nudges.map((n) => n.id), ["a", "z"]);
  assert.deepEqual(loaded.nudges[1], { id: "z", hook: "prompt", family: "gpt", text: "First line.\n\nSecond line.", file });
  assert.deepEqual(loadNudges({ roots: [join(cwd, "missing")] }), { nudges: [], broken: [] });
});

test("nudges: user filename replaces shipped, and off disables without requiring a hook or body", () => {
  put(shipped, "replace", "hook: prompt\nfamily: gpt", "Shipped.");
  put(shipped, "disabled", "hook: session", "Remove me.");
  const replacement = put(user, "replace", "hook: ui-edit\nfamily: claude", "User text.");
  put(user, "disabled", "off: true", "");
  put(user, "user-only", "hook: session", "Personal context.");
  const result = loadNudges({ roots });
  assert.deepEqual(result.broken, []);
  assert.deepEqual(result.nudges.map((n) => n.id), ["replace", "user-only"]);
  assert.deepEqual(result.nudges[0], { id: "replace", hook: "ui-edit", family: "claude", text: "User text.", file: replacement });
});

test("nudges: broken files are reported and a broken override does not resurrect shipped text", () => {
  put(shipped, "overridden", "hook: prompt");
  const bad = [
    put(user, "overridden", "family: gpt"),
    put(shipped, "unknown-hook", "hook: stop"),
    put(shipped, "unknown-family", "hook: prompt\nfamily: gemini"),
    put(shipped, "empty", "hook: prompt", "  \n"),
    put(shipped, "bad-off", "hook: prompt\noff: maybe"),
  ];
  const malformed = join(shipped, "malformed.md");
  writeFileSync(malformed, "No frontmatter.");
  bad.push(malformed);
  const { nudges, broken } = loadNudges({ roots });
  assert.deepEqual(nudges, []);
  assert.deepEqual(broken.map((b) => b.file).sort(), bad.sort());
  assert.ok(broken.every((b) => typeof b.error === "string" && b.error.length));
});

test("nudges: family filtering: gpt, claude, and other for every model outside both", () => {
  put(shipped, "all", "hook: prompt", "Universal.");
  put(shipped, "gpt", "hook: prompt\nfamily: gpt", "GPT context.");
  put(shipped, "claude", "hook: prompt\nfamily: claude", "Claude context.");
  put(shipped, "rest", "hook: session\nfamily: other", "Other models.");
  put(shipped, "other-hook", "hook: session", "Session only.");
  for (const model of [null, undefined, "gemini-3"]) assert.deepEqual(nudgeText("session", model, { roots }).ids, ["other-hook", "rest"]);
  for (const model of ["gpt-6.1-sol", "claude-opus-5-5"]) assert.deepEqual(nudgeText("session", model, { roots }).ids, ["other-hook"]);
  assert.deepEqual(nudgeText("prompt", "gpt-6.1-sol", { roots }), { ids: ["all", "gpt"], text: "Universal.\n\nGPT context." });
  assert.deepEqual(nudgeText("prompt", "claude-opus-5-5", { roots }), { ids: ["all", "claude"], text: "Universal.\n\nClaude context." });
  for (const model of [null, undefined, "gemini-3"]) assert.deepEqual(nudgeText("prompt", model, { roots }), { ids: ["all"], text: "Universal." });
  assert.deepEqual(nudgeText("ui-edit", null, { roots }), { ids: [], text: "" });
  process.env.JEVIS_NUDGES = "off";
  assert.deepEqual(nudgeText("prompt", "gpt-6.1-sol", { roots }), { ids: [], text: "" });
});

test("nudges: per-file text has a strict 1500-character cap", () => {
  put(shipped, "long", "hook: prompt", "x".repeat(5000));
  put(shipped, "exact", "hook: prompt", "y".repeat(1500));
  const { nudges } = loadNudges({ roots });
  assert.equal(nudges.find((n) => n.id === "long").text, `${"x".repeat(1499)}…`);
  assert.equal(nudges.find((n) => n.id === "exact").text, "y".repeat(1500));
});

test("nudges: prompts inject for GPT person and agent requests, never call Jev, and log metadata", async () => {
  fixtures();
  const output = await prompt("gpt");
  assert.equal(output.hookSpecificOutput.hookEventName, "UserPromptSubmit");
  assert.equal(context(output), "Understand the intent.");
  assert.equal(context(await prompt("agent", "gpt-6.1-sol", "[agent] Build the screen.")), "Understand the intent.");
  assert.equal(await prompt("claude", "claude-opus-5-5"), null);
  assert.equal(await prompt("unknown", "gemini-3"), null);
  assert.deepEqual(calls, []);
  const [{ at, ...row }] = nudgeRows("gpt");
  assert.ok(Number.isFinite(Date.parse(at)));
  assert.deepEqual(row, { event: "nudge", sessionId: "gpt", harness: "Codex", model: "gpt-6.1-sol", hook: "prompt", ids: ["prompt"], turn: 1 });
});

test("nudges: harness-written prompts bypass all nudge and turn bookkeeping", async () => {
  fixtures();
  for (const text of ["<task-notification>Finished</task-notification>", "<subagent_notification>done</subagent_notification>", "<system-reminder>context</system-reminder>"]) {
    assert.equal(await prompt("harness", "gpt-6.1-sol", text), null);
  }
  assert.equal(loadSession("harness").turn, 0);
  assert.deepEqual(nudgeRows(), []);
});

test("nudges: SessionStart sources inject using input or stored model, PostCompact never injects", async () => {
  fixtures();
  for (const source of ["startup", "resume", "clear", "compact"]) {
    const result = onSession({ session_id: source, cwd, hook_event_name: "SessionStart", source, model: "gpt-6.1-sol" });
    assert.equal(result.hookSpecificOutput.hookEventName, "SessionStart");
    assert.equal(context(result), "Session context.");
  }
  await prompt("stored");
  assert.equal(context(onSession({ session_id: "stored", cwd, source: "resume" })), "Session context.");
  assert.equal(onSession({ session_id: "stored", cwd, hook_event_name: "PostCompact", source: "compact", model: "gpt-6.1-sol" }), null);
  assert.equal(onSession({ session_id: "invalid-source", cwd, source: "other", model: "gpt-6.1-sol" }), null);
  assert.equal(nudgeRows("stored").filter((r) => r.hook === "session").length, 1);
  assert.deepEqual(calls, []);
});

test("nudges: session and prompt combine outage first, then a blank line and nudge", async () => {
  fixtures();
  for (let i = 0; i < 3; i++) recordHealth("HTTP 402 billing");
  assert.equal(context(await prompt("outage-prompt")), "Jevis is unavailable right now.\n\nUnderstand the intent.");
  assert.equal(context(onSession({ session_id: "outage-session", cwd, source: "startup", model: "gpt-6.1-sol" })), "Jevis is unavailable right now.\n\nSession context.");
  assert.equal(context(await prompt("outage-prompt")), "Understand the intent.", "outage is still once per session");
});

test("nudges: UI edits inject once per turn even when the wiki has no applicable entries", async () => {
  fixtures();
  await prompt("ui");
  const first = await tool("ui");
  assert.equal(first.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(context(first), "Avoid default design habits.");
  assert.equal(await tool("ui", "Edit", { file_path: "src/app/other.tsx", new_string: "x" }), null);
  assert.deepEqual(loadSession("ui").nudged, { uiEdit: 1 });
  await prompt("ui");
  assert.equal(context(await tool("ui")), "Avoid default design habits.");
  assert.deepEqual(loadSession("ui").nudged, { uiEdit: 2 });
  assert.deepEqual(nudgeRows("ui").filter((r) => r.hook === "ui-edit").map((r) => r.turn), [1, 2]);
  assert.ok(readLog().some((r) => r.event === "tool" && r.skipped === "no entries"));
  assert.deepEqual(calls, [], "nudges do not turn a skipped wiki check into a Jev call");
});

test("nudges: non-UI files, test files, Bash, Claude and unknown models do not get GPT UI context", async () => {
  fixtures();
  await prompt("non-ui");
  for (const file_path of ["src/server/db.ts", "src/app/page.test.tsx", "src/app/page.spec.jsx", "src/app/page.stories.tsx", "tests/page.tsx", "src/__tests__/page.tsx", "src\\tests\\page.tsx"]) {
    assert.equal(await tool("non-ui", "Write", { file_path, content: "x" }), null, file_path);
  }
  assert.equal(await tool("non-ui", "Bash", { command: "echo src/app/page.tsx" }), null);
  assert.equal(loadSession("non-ui").nudged, undefined);
  for (const model of ["claude-opus-5-5", "gemini-3"]) {
    await prompt(model, model);
    assert.equal(await tool(model), null);
    assert.equal(loadSession(model).nudged, undefined);
  }
});

test("nudges: edit tools, path aliases, patch headers, and Muse equivalents all select UI edits", async () => {
  fixtures();
  const cases = [
    ["Write", { path: "src/app/page.tsx" }],
    ["Edit", { file_path: "src/app/page.jsx" }],
    ["MultiEdit", { file_path: "src/app/page.vue", edits: [] }],
    ["NotebookEdit", { notebook_path: "src/app/page.svelte" }],
    ["apply_patch", { input: "*** Begin Patch\n*** Add File: src/app/page.astro\n+x\n*** End Patch" }],
    ["apply_patch", { patch: "*** Update File: src/app/page.html\n+x" }],
    ["apply_patch", "*** Delete File: src/app/page.css\n"],
    ["apply_patch", { command: "*** Update File: src/server/db.ts\n+x\n*** Add File: src/app/page.scss\n+y" }],
    ["write_file", { path: "src/app/page.tsx", content: "x" }, { model_provider: "meta" }],
    ["edit_file", { path: "src/app/page.tsx", find: "x", replace: "y" }, { model_provider: "meta" }],
  ];
  for (const [i, [name, input, extra]] of cases.entries()) {
    const id = `edit-${i}`;
    await prompt(id);
    assert.equal(context(await tool(id, name, input, extra)), "Avoid default design habits.", name);
  }
  assert.deepEqual(calls, []);
});

test("nudges: denies win and do not consume the turn's UI nudge", async () => {
  fixtures();
  const file = lesson("deny", "deny");
  await prompt("denied");
  const result = await tool("denied");
  assert.equal(result.hookSpecificOutput.permissionDecision, "deny");
  assert.equal(context(result), undefined);
  assert.equal(loadSession("denied").nudged, undefined);
  assert.equal(nudgeRows("denied").filter((r) => r.hook === "ui-edit").length, 0);
  rmSync(file);
  assert.equal(context(await tool("denied")), "Avoid default design habits.");
});

test("nudges: append after existing wiki notes without losing shown state or tool evidence", async () => {
  fixtures();
  lesson("note", "context");
  await prompt("notes");
  assert.equal(context(await tool("notes")), "Jevis, before this call:\n\n**Fixture lesson.** Existing lesson text.\n\nAvoid default design habits.");
  const session = loadSession("notes");
  assert.equal(session.shown.note, 1);
  assert.equal(session.nudged.uiEdit, 1);
  assert.equal(session.hookItems.length, 1);
  assert.equal(await tool("notes"), null);
});

test("nudges: shadow mode and off switch suppress every hook and nudge log", async () => {
  fixtures();
  for (const [key, value] of [["JEVIS_MODE", "shadow"], ["JEVIS_NUDGES", "off"]]) {
    process.env[key] = value;
    assert.equal(await prompt(key), null);
    assert.equal(onSession({ session_id: key, cwd, source: "startup", model: "gpt-6.1-sol" }), null);
    assert.equal(await tool(key), null);
    assert.equal(loadSession(key).nudged, undefined);
    delete process.env[key];
  }
  assert.deepEqual(nudgeRows(), []);
});

test("nudges: broken files and unreadable roots fail open without hook errors", async () => {
  put(shipped, "bad", "hook: nope");
  const notDirectory = join(cwd, "not-directory");
  writeFileSync(notDirectory, "x");
  process.env.JEVIS_NUDGES_DIR = notDirectory;
  assert.equal(await prompt("broken"), null);
  assert.equal(onSession({ session_id: "broken", cwd, source: "startup", model: "gpt-6.1-sol" }), null);
  assert.equal(await tool("broken"), null);
  assert.deepEqual(nudgeRows(), []);
  assert.deepEqual(readLog().filter((r) => r.event === "hook-error"), []);
});

test("nudges: lint reports counts and broken nudges cause exit 1 even when nudges are off", () => {
  fixtures();
  const run = () => spawnSync(process.execPath, [cli, "lint"], { env: process.env, cwd, encoding: "utf8" });
  const good = run();
  assert.equal(good.status, 0, good.stderr);
  assert.match(good.stdout, /nudges: 3 \(session 1, prompt 1, feedback 0, feedback-repeat 0, ui-edit 1\)/);
  const broken = put(user, "broken", "hook: unknown");
  process.env.JEVIS_NUDGES = "off";
  const bad = run();
  assert.equal(bad.status, 1, bad.stderr);
  assert.ok(bad.stdout.includes(`BROKEN nudge ${broken}: hook must be one of session, prompt, feedback, feedback-repeat, ui-edit`));
});

test("nudges: config accepts on and off, rejects unknown values", () => {
  const file = join(process.env.JEVIS_HOME, "config.json");
  for (const value of ["on", "off"]) {
    writeFileSync(file, JSON.stringify({ JEVIS_NUDGES: value }));
    assert.deepEqual(readConfig(file).values, { JEVIS_NUDGES: value });
    assert.deepEqual(readConfig(file).errors, []);
  }
  assert.equal(SETTINGS.JEVIS_NUDGES.help, "off stops every nudge");
  writeFileSync(file, JSON.stringify({ JEVIS_NUDGES: true }));
  assert.equal(readConfig(file).errors.length, 1);
});

test("feedback: short vague dissatisfaction matches; clear instructions and long messages do not", () => {
  for (const t of ["not good", "It's not good.", "this doesn't fit what I had in mind", "try again", "nope", "meh", "still wrong", "that\u2019s not it", "not what I wanted", "hmm no, doesn't feel right"]) assert.equal(isVagueFeedback(t), true, t);
  for (const t of ["", "make the header blue", "add a logout button to the nav", "great, ship it", "turn off the dark mode toggle", `not good ${"x".repeat(150)}`]) assert.equal(isVagueFeedback(t), false, t);
});

test("feedback: the first vague correction gets the feedback tip, later ones the stronger tip; GPT only", async () => {
  fixtures();
  put(shipped, "fb", "hook: feedback\nfamily: gpt", "First feedback tip.");
  put(shipped, "fb2", "hook: feedback-repeat\nfamily: gpt", "Stronger feedback tip.");
  await prompt("fb", "gpt-6.1-sol", "not good");
  assert.doesNotMatch(context(await prompt("fb2-first")) ?? "", /feedback tip/, "a first message is never feedback");
  assert.match(context(await prompt("fb", "gpt-6.1-sol", "Build the page.")) ?? "", /^Understand the intent\.$/);
  const first = context(await prompt("fb", "gpt-6.1-sol", "not good, try again"));
  assert.match(first, /Understand the intent\.\n\nFirst feedback tip\./);
  assert.doesNotMatch(first, /Stronger/);
  assert.match(context(await prompt("fb", "gpt-6.1-sol", "meh")), /Stronger feedback tip\./);
  assert.deepEqual(nudgeRows("fb").filter((r) => r.hook.startsWith("feedback")).map((r) => r.hook), ["feedback", "feedback-repeat"]);
  await prompt("claude", "claude-opus-5-5", "Build the page.");
  assert.equal(context(await prompt("claude", "claude-opus-5-5", "not good")), undefined);
});
