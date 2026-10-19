import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const root = mkdtempSync(join(tmpdir(), "jevis-approve-"));
for (const key of Object.keys(process.env)) if (key.startsWith("JEVIS_")) delete process.env[key];
process.env.JEVIS_HOME = join(root, "home");
process.env.JEVIS_WIKI = join(root, "wiki");
process.env.JEVIS_NUDGES = "off";
mkdirSync(process.env.JEVIS_WIKI);
after(() => rmSync(root, { recursive: true, force: true }));
for (const id of ["visible", "other", "code"]) writeFileSync(join(process.env.JEVIS_WIKI, `${id}.md`), [
  "---", "event: tool", `tools: [${id === "code" ? "Write" : "Bash"}]`, `ask: Does \`input\` run ${id}?`, "unless: Did `request` explicitly ask for this call?",
  ...(id === "code" ? ["decide: em_dash_copy"] : []),
  "action: deny", `title: ${id}`, "source: test", "min: 0.8", "---", "Check this call.",
].join("\n"));

const { isApproval, onPrompt, onSession, onTool } = await import("../src/hooks.mjs");
const { loadSession, readLog } = await import("../src/state.mjs");
const { setJevTransport } = await import("../src/jev.mjs");
const { loadWiki } = await import("../src/wiki.mjs");
assert.deepEqual(loadWiki([process.env.JEVIS_WIKI]).broken, []);
const evaluated = [];
setJevTransport(async ({ questions, state }) => {
  evaluated.push(Object.keys(questions));
  return { answers: Object.fromEntries(Object.keys(questions).map((id) => [id, { noul: !id.endsWith("#unless") && state.input?.includes(id) ? 0.99 : 0.01 }])) };
});
const prompt = (id, text) => onPrompt({ session_id: id, cwd: root, prompt: text });
const tool = (id, command = "launch-visible") => onTool({ session_id: id, cwd: root, tool_name: "Bash", tool_input: { command } });
const codeTool = (id) => onTool({ session_id: id, cwd: root, tool_name: "Write", tool_input: { file_path: "index.html", content: "<p>One — two</p>" } });
const denied = (result) => result?.hookSpecificOutput?.permissionDecision === "deny";

test("approval: short affirmative phrases, punctuation and emoji; never negations or long requests", () => {
  for (const text of ["go ahead", "go for it", "do it", "yes", "yep", "yeah", "y", "ok", "okay", "sure", "proceed", "run it", "approved", "approve", "allowed", "that's fine", "thats fine", "fine", "please do", "you can", "it's fine", "its fine", "go ahead and open it", "ok do it", "  GO AHEAD!!! 👍🏽  ", "yes, open another window", "yes it\u2019s fine"]) {
    assert.equal(isApproval(text), true, text);
  }
  for (const text of ["", "👍", "no", "yes but not headed", "yes don't open it", "yes dont", "yes not", "yes stop", "yes wait", "yes never", "yes but", "yes no", "yesterday", "good", "okayish", "go", "continue", "go back to the old design", "continue with the headless version", "yes use the headless one instead", "ok now refactor the auth module please", "can you go ahead and refactor the whole auth module and also add tests for it", `yes ${"x".repeat(57)}`]) {
    assert.equal(isApproval(text), false, text);
  }
  assert.equal(isApproval(`yes ${"x".repeat(56)}`), true, "60 characters is allowed");
  assert.equal(isApproval(`yes ${"x ".repeat(5)}`), false, "at most four words after the approval");
});

test("approval: deny then go ahead removes just that lesson from the evaluated pool for the session", async () => {
  await prompt("approve", "open the fixture");
  const result = await tool("approve");
  assert.ok(denied(result));
  assert.match(result.hookSpecificOutput.permissionDecisionReason, /rest of the session/);
  assert.deepEqual(loadSession("approve").denied, { turn: 1, ids: ["visible"] });
  const before = evaluated.length;
  await prompt("approve", "go ahead");
  assert.equal(evaluated.length, before, "approval itself costs no model call");
  assert.deepEqual(loadSession("approve").allowed, ["visible"]);
  assert.equal(loadSession("approve").denied, null);
  assert.ok(!denied(await tool("approve")));
  assert.ok(!evaluated.at(-1).includes("visible"));
  assert.ok(denied(await tool("approve", "launch-other")), "another deny lesson still applies");
  const { at, ...approval } = readLog().find((row) => row.event === "approve" && row.sessionId === "approve");
  assert.ok(Number.isFinite(Date.parse(at)));
  assert.deepEqual(approval, {
    event: "approve", sessionId: "approve", harness: "Codex", turn: 2, lifted: ["visible"], request: "go ahead",
  });
  await prompt("approve", "an unrelated next turn");
  assert.ok(!denied(await tool("approve")), "permission persists across later prompts");
});

test("approval: a negative reply keeps the deny, and unrelated intervening turns expire pending denies", async () => {
  await prompt("negative", "open the fixture");
  assert.ok(denied(await tool("negative")));
  await prompt("negative", "no, keep it headless");
  assert.deepEqual(loadSession("negative").allowed, []);
  assert.equal(loadSession("negative").denied, null);
  assert.ok(denied(await tool("negative")));
  await prompt("expired", "open the fixture");
  assert.ok(denied(await tool("expired")));
  await prompt("expired", "explain something unrelated");
  await prompt("expired", "go ahead");
  assert.deepEqual(loadSession("expired").allowed, []);
  assert.ok(denied(await tool("expired")));
});

test("approval: same-turn denies accumulate without duplicates; compact keeps lifts, clear resets them", async () => {
  await prompt("multiple", "open fixtures");
  for (const command of ["launch-visible", "launch-other", "launch-visible"]) assert.ok(denied(await tool("multiple", command)));
  assert.deepEqual(loadSession("multiple").denied.ids, ["visible", "other"]);
  await prompt("multiple", "yes");
  onSession({ session_id: "multiple", cwd: root, source: "compact" });
  assert.deepEqual(loadSession("multiple").allowed, ["visible", "other"]);
  onSession({ session_id: "multiple", cwd: root, source: "clear" });
  assert.deepEqual(loadSession("multiple").allowed, []);
  assert.ok(denied(await tool("multiple")));
});

test("approval: code-decided denies are lifted, and an empty pool costs no model call", async () => {
  await prompt("code", "write the page");
  assert.ok(denied(await codeTool("code")));
  await prompt("code", "go ahead");
  assert.ok(!denied(await codeTool("code")));
  assert.ok(!evaluated.at(-1).includes("code"));
  // Lift the two model lessons too: no candidates remain, so evaluate skips Jev entirely.
  assert.ok(denied(await tool("code", "launch-visible launch-other")));
  await prompt("code", "sure");
  const before = evaluated.length;
  assert.equal(await codeTool("code"), null);
  assert.equal(evaluated.length, before);
  assert.equal(readLog().at(-1).skipped, "no entries");
});

test("approval: shadow denies never become pending user approvals", async () => {
  process.env.JEVIS_MODE = "shadow";
  try {
    await prompt("shadow", "open the fixture");
    assert.equal(await tool("shadow"), null);
    assert.equal(loadSession("shadow").denied, null);
    await prompt("shadow", "go ahead");
    assert.deepEqual(loadSession("shadow").allowed, []);
  } finally { delete process.env.JEVIS_MODE; }
});
