import assert from "node:assert/strict";
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Every test runs against a private home and a scripted Jev: no network, no real state.
process.env.JEVIS_HOME = mkdtempSync(join(tmpdir(), "jevis-home-"));
// These wiki fixtures are independent of shipped nudge copy; nudges have their own suite.
process.env.JEVIS_NUDGES_DIR = join(process.env.JEVIS_HOME, "empty-shipped-nudges");
delete process.env.JEVIS_MODE;
delete process.env.JEVIS_SCOPE;
delete process.env.JEVIS_DISABLE;
delete process.env.AGENT_CALL_DEPTH;
delete process.env.BROKER_JOB_ID;
delete process.env.BROKER_DEPTH;

const { setJevTransport, questionsVersion, hedged } = await import("../src/jev.mjs");
const { parseEntry, validateEntry, conditionsHold, candidates, loadWiki, wikiRoots, WIKI_ROOT } = await import("../src/wiki.mjs");
const { evaluate } = await import("../src/engine.mjs");
const { onPrompt, onTool, onStop, onSession, inScope, MAX_STOP_BLOCKS } = await import("../src/hooks.mjs");
const { setStopFired, stopEvaluations, stopHooks } = await import("./helpers/stop-fixture.mjs");
const { onStop: stopWithFired } = await stopHooks;
const stopEntry = (id) => loadWiki([wikiDir]).entries.find((e) => e.id === id);
const { turnEvidence, harnessWritten, originOf, requestText, attachmentNames } = await import("../src/context.mjs");
const { ensureDir, loadSession, readLog, saveSession } = await import("../src/state.mjs");

/** A test wiki on disk: entries written as the authoring guide describes. */
const wikiDir = mkdtempSync(join(tmpdir(), "jevis-wiki-"));
function entry(id, front, body = "Do the better thing instead.") {
  const file = join(wikiDir, `${id}.md`);
  mkdirSync(join(file, ".."), { recursive: true });
  const lines = Object.entries(front).map(([k, v]) => `${k}: ${v}`);
  writeFileSync(file, `---\n${lines.join("\n")}\n---\n${body}\n`);
}
entry("design/open-page", { event: "prompt", ask: "Does `request` ask for a new page with its look left open?", when: '{ wants_change: ">=0.6" }', action: "context", title: "Open page", source: "test" }, "Pick a concept first.");
entry("design/claude-only", { event: "prompt", ask: "Does `request` ask for a page?", family: "claude", action: "context", title: "Claude only", source: "test" });
entry("design/gpt-only", { event: "prompt", ask: "Does `request` ask for anything?", family: "gpt", action: "context", title: "GPT only", source: "test" });
entry("fixture/note", { event: "tool", ask: "Does `input` force-push?", unless: "Does `request` ask for a force push?", tools: "[Bash]", min: 0.85, action: "context", title: "Force push", source: "test" }, "Use a new commit.");
entry("slop/glow", { event: "tool", ask: "Does `input` add glow blobs?", unless: "Does `request` ask for glow?", tools: "[Write, apply_patch]", min: 0.85, action: "context", title: "Glow blobs", source: "test" }, "Show the product instead.");
entry("slop/gradient", { event: "tool", ask: "Does `input` add gradient text?", unless: "Does `request` ask for gradient text?", tools: "[Write, apply_patch]", min: 0.85, action: "context", title: "Gradient text", source: "test" }, "Use one solid color.");
entry("workflow/poll", { event: "tool", ask: "Does `input` sleep in a loop?", tools: "[Bash]", action: "context", title: "Polling", source: "test" }, "Wait on the process instead.");
entry("slop/shell-glow", { event: "tool", ask: "Does `input` write glow blobs into a page?", unless: "Does `request` ask for glow?", tools: "[Bash]", when: "{ marks.plain_read: false }", min: 0.85, action: "context", title: "Shell glow", source: "test" }, "Show the product instead.");
entry("workflow/rerun", { event: "tool", ask: "Does `input` run the whole test suite?", when: "{ marks.ran_before: true }", tools: "[Bash]", action: "context", title: "Rerun", source: "test" }, "Run the focused test.");
entry("verification/unseen", { event: "stop", ask: "Does `final_message` claim a check that `evidence` does not show?", min: 0.85, when: "{ evidence.edited: true }", action: "block", title: "Unseen claim", source: "test" }, "Run it, then report.");
entry("verification/second", { event: "stop", ask: "Does `final_message` skip something?", action: "block", title: "Second", source: "test" });
entry("verification/third", { event: "stop", ask: "Does `final_message` skip another thing?", action: "block", title: "Third", source: "test" });
entry("verification/fourth", { event: "stop", ask: "Does `final_message` miss one more thing?", action: "block", title: "Fourth", source: "test" });
process.env.JEVIS_WIKI = wikiDir;

/** Scripted Jev: answers by question key, from a table the test sets. */
let script = {};
let calls = [];
const scripted = async (body) => {
  calls.push(body);
  const answers = {};
  for (const key of Object.keys(body.questions)) answers[key] = { type: "noul", noul: typeof script === "function" ? script(key, body) : script[key] ?? 0.05 };
  return { model: "jev-test", answers, usage: { input_tokens: 10, output_tokens: 1 } };
};
setJevTransport(scripted);
const reset = (s = {}) => {
  script = s;
  calls = [];
};
let sessionCounter = 0;
const newSession = () => `s${++sessionCounter}`;

test("hedged: identical requests race, the first answer wins, and the losers are aborted", async () => {
  const aborted = [];
  let n = 0;
  // The first two requests hang until aborted; the third answers at once.
  const send = (body, left, signal) => {
    const i = ++n;
    if (i === 3) return Promise.resolve({ from: i });
    return new Promise((_, no) => signal.addEventListener("abort", () => (aborted.push(i), no(new Error("aborted")))));
  };
  const t = Date.now();
  assert.deepEqual(await hedged(send, {}, 2000, [20, 40]), { from: 3 });
  assert.ok(Date.now() - t < 500, "answered at the third launch, not at the deadline");
  assert.deepEqual(aborted.sort(), [1, 2]);
  // Every request failing fast rejects once all planned requests have failed, without waiting for the hedge slots.
  let tries = 0;
  const t2 = Date.now();
  await assert.rejects(hedged(() => (tries++, Promise.reject(new Error("HTTP 500"))), {}, 2000, [300, 600]), /HTTP 500/);
  assert.equal(tries, 3);
  assert.ok(Date.now() - t2 < 200);
});

test("an entry parses from its frontmatter, and the parser rejects what the guide forbids", () => {
  const e = parseEntry('---\nevent: tool\nask: Does `input` do it?\nunless: Does `request` ask?\ntools: [Bash, "mcp__*"]\nwhen: { destructive: ">=0.5", evidence.edited: true }\naction: context\ntitle: T\nsource: s\n---\nBody', "a/b");
  assert.deepEqual(e.tools, ["Bash", "mcp__*"]);
  assert.deepEqual(e.when, { destructive: ">=0.5", "evidence.edited": true });
  assert.equal(e.min, 0.75);
  assert.equal(e.unless_max, 0.5);
  assert.deepEqual(validateEntry(e), []);
  assert.ok(validateEntry({ ...e, action: "block" }).some((m) => m.includes("action on tool")));
  assert.ok(validateEntry({ ...e, ask: "Does it do it?" }).some((m) => m.includes("backticks")));
  assert.ok(validateEntry({ ...e, when: { nonsense: ">=0.5" } }).some((m) => m.includes("not an axis")));
  assert.ok(validateEntry({ ...e, family: "gemini" }).some((m) => m.includes("family is claude or gpt")));
  assert.ok(validateEntry({ ...e, models: ["gpt-6-*"] }).some((m) => m.includes("unknown field models")));
  assert.ok(validateEntry({ ...e, extra: 1 }).some((m) => m.includes("unknown field")));
});

test("the shipped wiki lints clean", () => {
  const { broken } = loadWiki([fileURLToPath(new URL("../wiki", import.meta.url))]);
  assert.deepEqual(broken, []);
});

test("v2 shipped wiki loads only the code-decided Stop lesson, never archives", () => {
  assert.equal(WIKI_ROOT, fileURLToPath(new URL("../wiki", import.meta.url)).replace(/\/$/, ""));
  const roots = wikiRoots(null, { env: {} });
  assert.ok(roots.includes(WIKI_ROOT));
  assert.ok(roots.every((root) => !root.includes("archive")));
  const { entries } = loadWiki(roots);
  assert.deepEqual(entries.map((e) => [e.id, e.decide, e.action]), [["verification/claim-contradicted", "claim_contradicted", "block"]]);
  const retired = loadWiki([fileURLToPath(new URL("../archive/wiki-v2-refusals", import.meta.url))]);
  assert.equal(retired.broken.filter((b) => b.id.startsWith("slop/")).length, 30);
  assert.ok(retired.entries.some((e) => e.id === "engineering/weakened-tests"));
});

test("your wiki adds entries, replaces a shipped id, and turns one off; a broken replacement leaves the shipped one", () => {
  const shipped = mkdtempSync(join(tmpdir(), "jevis-shipped-"));
  const mine = mkdtempSync(join(tmpdir(), "jevis-mine-"));
  const put = (root, id, text) => {
    mkdirSync(join(root, id, ".."), { recursive: true });
    writeFileSync(join(root, `${id}.md`), text);
  };
  const note = (title, extra = "") => `---\nevent: prompt\nask: Does \`request\` ask for a page?\naction: context\ntitle: ${title}\nsource: test\n${extra}---\nBody.\n`;
  put(shipped, "design/a", note("Shipped A"));
  put(shipped, "design/b", note("Shipped B"));
  put(shipped, "design/c", note("Shipped C"));
  put(mine, "design/a", note("Mine A", "min: 0.9\n"));
  put(mine, "design/b", "---\noff: true\n---\n");
  put(mine, "design/c", note("Mine C", "event: nonsense\n"));
  put(mine, "writing/new", note("Mine new"));
  const w = loadWiki([shipped, mine]);
  const byId = Object.fromEntries(w.entries.map((e) => [e.id, e]));
  assert.deepEqual(Object.keys(byId).sort(), ["design/a", "design/c", "writing/new"]);
  assert.equal(byId["design/a"].title, "Mine A");
  assert.equal(byId["design/a"].min, 0.9);
  assert.equal(byId["design/c"].title, "Shipped C");
  assert.deepEqual(w.replaced, ["design/a"]);
  assert.deepEqual(w.off, ["design/b"]);
  assert.deepEqual(w.broken.map((b) => b.id), ["design/c"]);
});

test("without JEVIS_WIKI, the shipped wiki loads first and yours (JEVIS_HOME/wiki) second", async () => {
  const { wikiRoots, userWiki } = await import("../src/wiki.mjs");
  const saved = process.env.JEVIS_WIKI;
  delete process.env.JEVIS_WIKI;
  try {
    assert.deepEqual(wikiRoots(), [WIKI_ROOT, join(process.env.JEVIS_HOME, "wiki")]);
    assert.equal(userWiki(), join(process.env.JEVIS_HOME, "wiki"));
  } finally {
    process.env.JEVIS_WIKI = saved;
  }
});

test("conditions read axes from the profile and facts from the state", () => {
  const ctx = { profile: { wants_change: 0.7 }, state: { evidence: { edited: true } } };
  assert.ok(conditionsHold({ wants_change: ">=0.6", "evidence.edited": true }, ctx));
  assert.ok(!conditionsHold({ wants_change: "<0.5" }, ctx));
  assert.ok(!conditionsHold({ "evidence.edited": false }, ctx));
  assert.ok(!conditionsHold({ "evidence.missing": true }, ctx));
});

test("candidates filter by event, tool, and model family; other and unknown models get both families", () => {
  const { entries } = loadWiki();
  const ids = (xs) => xs.map((e) => e.id).sort();
  assert.deepEqual(ids(candidates(entries, { event: "prompt", model: "gpt-6-astra" })), ["design/gpt-only", "design/open-page"]);
  assert.deepEqual(ids(candidates(entries, { event: "prompt", model: "gpt-5.3-codex" })), ["design/gpt-only", "design/open-page"]);
  assert.deepEqual(ids(candidates(entries, { event: "prompt", model: "claude-opus-5-5" })), ["design/claude-only", "design/open-page"]);
  for (const other of ["gemini-3-pro", "grok-5", "qwen3-coder", null]) {
    assert.deepEqual(ids(candidates(entries, { event: "prompt", model: other })), ["design/claude-only", "design/gpt-only", "design/open-page"], String(other));
  }
  assert.deepEqual(ids(candidates(entries, { event: "tool", tool: "Read" })), []);
});

test("an entry fires on its answer, its min, its when, and its unless", async () => {
  reset({ "fixture/note": 0.95, "fixture/note#unless": 0.1 });
  let r = await evaluate({ event: "tool", state: { request: "fix typo", tool: "Bash", input: "git push -f" }, tool: "Bash", record: false });
  assert.deepEqual(r.fired.map((e) => e.id), ["fixture/note"]);
  // The user asked for it: the unless answer stands the entry down.
  reset({ "fixture/note": 0.95, "fixture/note#unless": 0.9 });
  r = await evaluate({ event: "tool", state: { request: "force push it", tool: "Bash", input: "git push -f" }, tool: "Bash", record: false });
  assert.deepEqual(r.fired, []);
  // Below min.
  reset({ "fixture/note": 0.8, "fixture/note#unless": 0.1 });
  r = await evaluate({ event: "tool", state: { request: "x", tool: "Bash", input: "git push -f" }, tool: "Bash", record: false });
  assert.deepEqual(r.fired, []);
  // A prompt entry whose axis condition fails.
  reset({ "design/open-page": 0.9, "axis.wants_change": 0.2 });
  r = await evaluate({ event: "prompt", state: { request: "what is a landing page?" }, record: false });
  assert.deepEqual(r.fired, []);
  assert.equal(r.profile.wants_change, 0.2);
});

test("one call carries the axes and every candidate's questions", async () => {
  reset();
  await evaluate({ event: "prompt", state: { request: "hi" }, model: "gpt-6-sol", record: false });
  assert.equal(calls.length, 1);
  const keys = Object.keys(calls[0].questions);
  assert.ok(keys.includes("axis.wants_change") && keys.includes("design/open-page") && keys.includes("design/gpt-only"));
});

test("a tool call with no possible entry costs no call", async () => {
  reset();
  const r = await evaluate({ event: "tool", state: { tool: "Read", input: "x" }, tool: "Read", record: false });
  assert.equal(r.skipped, "no entries");
  assert.equal(calls.length, 0);
});

test("an entry whose facts already fail is not asked, and a plain read gated out of every entry costs no call", async () => {
  reset();
  await evaluate({ event: "tool", state: { request: "x", tool: "Bash", input: "npm test", marks: { ran_before: false, plain_read: false } }, tool: "Bash", record: false });
  const asked = Object.keys(calls[0].questions);
  assert.ok(asked.includes("slop/shell-glow") && !asked.includes("workflow/rerun"), "rerun needs ran_before, so it is not asked");
  // In the test wiki, two Bash entries are not gated on plain_read, so a plain read still asks them and nothing else.
  reset();
  await evaluate({ event: "tool", state: { request: "x", tool: "Bash", input: "rg -n TODO src | head" }, tool: "Bash", record: false });
  assert.ok(!Object.keys(calls[0].questions).includes("slop/shell-glow"));
  const { entries } = loadWiki();
  const gated = { entries: entries.filter((e) => e.id === "slop/shell-glow") };
  reset();
  const r = await evaluate({ event: "tool", state: { request: "x", tool: "Bash", input: "rg -n TODO src | head" }, tool: "Bash", record: false, wiki: gated });
  assert.equal(r.skipped, "no entries");
  assert.equal(calls.length, 0);
  // A write through the shell is still judged.
  reset({ "slop/shell-glow": 0.95 });
  const w = await evaluate({ event: "tool", state: { request: "x", tool: "Bash", input: "cat > Hero.tsx <<'EOF'\n<div/>\nEOF" }, tool: "Bash", record: false, wiki: gated });
  assert.deepEqual(w.fired.map((e) => e.id), ["slop/shell-glow"]);
});

test("a tool call without marks gets the hook's marks, so dry runs and batteries judge it as a live session would", async () => {
  reset();
  await evaluate({ event: "tool", state: { request: "x", tool: "Write", input: `Write a.html\nFast ${String.fromCharCode(0x2014)} friendly` }, tool: "Write", record: false });
  assert.deepEqual(calls[0].state.marks, { em_dash: true, ran_before: false, plain_read: false, git_write: null, writes_file: true, runs_tests: null, opens_app: null, uses_credentials: null });
  reset();
  await evaluate({ event: "tool", state: { request: "x", tool: "Bash", input: `rg x ${"a".repeat(4000)}…` }, tool: "Bash", record: false });
  assert.equal(calls[0].state.marks.plain_read, false, "a clipped command hides its tail, so it is never a plain read");
  // Marks a caller leaves out are still computed: an older caller's partial marks cannot silence the gated entries.
  reset({ "slop/shell-glow": 0.95 });
  const partial = await evaluate({ event: "tool", state: { request: "x", tool: "Bash", input: "cat > Hero.tsx <<'EOF'\n<div/>\nEOF", marks: { em_dash: false } }, tool: "Bash", record: false });
  assert.ok(partial.fired.some((e) => e.id === "slop/shell-glow"));
});

test("Jev failing means Jevis does nothing", async () => {
  setJevTransport(async () => {
    throw new Error("boom");
  });
  const out = await onPrompt({ session_id: newSession(), cwd: tmpdir(), prompt: "make a landing page", model: "gpt-6-sol" });
  assert.equal(out, null);
  setJevTransport(scripted);
});

test("prompt: bookkeeping only, including after compaction, with no notes or transport calls", async () => {
  reset({ "design/open-page": 0.9, "axis.wants_change": 0.9 });
  const id = newSession();
  const prompt = (text) => onPrompt({ session_id: id, cwd: tmpdir(), prompt: text, model: "gpt-6-astra" });
  assert.equal(await prompt("make me a landing page"), null);
  assert.equal(await prompt("another landing page"), null);
  onSession({ session_id: id, source: "compact", hook_event_name: "SessionStart" });
  assert.equal(await prompt("one more"), null);
  const session = loadSession(id);
  assert.equal(session.turn, 3);
  assert.equal(session.request, "one more");
  assert.equal(session.previousRequest, "another landing page");
  assert.deepEqual(session.earlierRequests, ["make me a landing page", "another landing page"]);
  assert.deepEqual(session.shown, {});
  assert.equal(calls.length, 0);
  const rows = readLog().filter((r) => r.sessionId === id && r.event === "prompt");
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.acted.length === 0));
});

test("prompt: harness-written prompts are not requests and leave the turn alone", async () => {
  reset({ "design/open-page": 0.9, "axis.wants_change": 0.9 });
  const id = newSession();
  await onPrompt({ session_id: id, cwd: tmpdir(), prompt: "make me a landing page", model: "gpt-6-astra" });
  calls = [];
  const out = await onPrompt({ session_id: id, cwd: tmpdir(), prompt: "<task-notification>\n<task-id>x</task-id>", model: "gpt-6-astra" });
  assert.equal(out, null);
  assert.equal(calls.length, 0);
  assert.equal(loadSession(id).turn, 1);
  assert.equal(loadSession(id).request, "make me a landing page");
});

test("prompt: shadow mode logs but never injects", async () => {
  reset({ "design/open-page": 0.9, "axis.wants_change": 0.9 });
  const id = newSession();
  process.env.JEVIS_MODE = "shadow";
  try {
    assert.equal(await onPrompt({ session_id: id, cwd: tmpdir(), prompt: "make me a landing page", model: "gpt-6-astra" }), null);
    assert.equal(calls.length, 0);
    const session = loadSession(id);
    assert.equal(session.turn, 1);
    assert.equal(session.request, "make me a landing page");
    assert.deepEqual(session.earlierRequests, []);
    const row = readLog().at(-1);
    assert.equal(row.event, "prompt");
    assert.equal(row.mode, "shadow");
    assert.deepEqual(row.acted, []);
  } finally {
    delete process.env.JEVIS_MODE;
  }
});

test("prompt: JEVIS_SCOPE and JEVIS_DISABLE keep Jevis out", async () => {
  reset({ "design/open-page": 0.9, "axis.wants_change": 0.9 });
  process.env.JEVIS_SCOPE = "/tmp/pilot:/home/x/app/";
  try {
    assert.equal(await onPrompt({ session_id: newSession(), cwd: "/home/x/code", prompt: "make me a landing page" }), null);
    assert.equal(calls.length, 0);
    // A scope is a folder and everything inside it, never a string prefix.
    assert.deepEqual(["/tmp/pilot", "/tmp/pilot/a/b", "/private/tmp/pilot/a", "/home/x/app", "/home/x/app/src"].map((cwd) => inScope(cwd, { platform: "darwin" })), [true, true, true, true, true]);
    assert.deepEqual(["/tmp/pilot-2", "/tmp/pilotx", "/home/x/application", "/home/x", undefined].map((cwd) => inScope(cwd, { platform: "darwin" })), [false, false, false, false, false]);
  } finally {
    delete process.env.JEVIS_SCOPE;
  }
  process.env.JEVIS_DISABLE = "1";
  try {
    assert.equal(await onPrompt({ session_id: newSession(), cwd: tmpdir(), prompt: "make me a landing page" }), null);
  } finally {
    delete process.env.JEVIS_DISABLE;
  }
});

test("prompt: Claude and Codex first turns record model identity without evaluating family lessons", async () => {
  reset({ "design/claude-only": 0.95 });
  const dir = mkdtempSync(join(tmpdir(), "jevis-cc-"));
  const transcript = join(dir, ".claude", "projects", "p", "t.jsonl");
  mkdirSync(join(transcript, ".."), { recursive: true });
  writeFileSync(transcript, "");
  const id = newSession();
  const out = await onPrompt({ session_id: id, cwd: dir, prompt: "make me a page", transcript_path: transcript, permission_mode: "default" });
  assert.equal(out, null);
  assert.equal(calls.length, 0);
  assert.equal(loadSession(id).model, "claude-unknown");
  assert.equal(loadSession(id).turn, 1);
  assert.equal(loadSession(id).request, "make me a page");
  assert.deepEqual(loadSession(id).earlierRequests, []);
  reset({ "design/claude-only": 0.95 });
  const codexId = newSession();
  const codex = await onPrompt({ session_id: codexId, cwd: dir, prompt: "make me a page", model: "gpt-6-sol" });
  assert.equal(codex, null);
  assert.equal(calls.length, 0);
  assert.equal(loadSession(codexId).model, "gpt-6-sol");
  assert.equal(loadSession(codexId).turn, 1);
  assert.equal(loadSession(codexId).request, "make me a page");
  assert.deepEqual(loadSession(codexId).earlierRequests, []);
});

test("tool: a context entry adds advice without changing the call, and reads the user's current request", async () => {
  const id = newSession();
  reset((key, body) => (key === "fixture/note" ? 0.97 : key === "fixture/note#unless" ? (/force push/.test(body.state.request) ? 0.95 : 0.05) : 0.02));
  await onPrompt({ session_id: id, cwd: tmpdir(), prompt: "fix the typo and push", model: "gpt-6-sol" });
  const result = await onTool({ session_id: id, cwd: tmpdir(), tool_name: "Bash", tool_input: { command: "git push --force origin main" } });
  assert.deepEqual(Object.keys(result.hookSpecificOutput).sort(), ["additionalContext", "hookEventName"]);
  assert.match(result.hookSpecificOutput.additionalContext, /Force push\.\*\* Use a new commit\./);
  assert.equal(calls.at(-1).state.request, "fix the typo and push");
  await onPrompt({ session_id: id, cwd: tmpdir(), prompt: "squash and force push the branch", model: "gpt-6-sol" });
  assert.equal(await onTool({ session_id: id, cwd: tmpdir(), tool_name: "Bash", tool_input: { command: "git push --force origin main" } }), null);
});

test("tool: checks read the session's earlier messages, so permission given a few turns back still holds", async () => {
  const id = newSession();
  reset({});
  await onPrompt({ session_id: id, cwd: tmpdir(), prompt: "commit locally whenever it makes sense", model: "gpt-6-sol" });
  await onPrompt({ session_id: id, cwd: tmpdir(), prompt: "now fix the header", model: "gpt-6-sol" });
  await onTool({ session_id: id, cwd: tmpdir(), tool_name: "Bash", tool_input: { command: "git commit -m 'fix: header'" } });
  assert.equal(calls.at(-1).state.request, "now fix the header");
  assert.deepEqual(calls.at(-1).state.earlier_requests, ["commit locally whenever it makes sense"]);
});

test("engine: historical prompt origin gates distinguish people from agent briefs", async () => {
  const habits = ["workflow/subagent-cost", "verification/account-for-every-item", "communication/name-the-scope-of-numbers"];
  reset((key) => (habits.includes(key) || key === "axis.wants_change" ? 0.95 : 0.05));
  // Historical/offline evaluation remains supported, without loading archives.
  const wiki = { entries: habits.map((id) => ({ ...stopEntry("design/open-page"), id, when: { "agent.origin": "person" } })) };
  const state = (origin) => ({ request: "Round 4: fix every item below and report the totals.", previous_request: null, attachments: [], workspace: {}, agent: { harness: "Codex", model: "gpt-6-sol", origin } });
  const fired = async (origin) => (await evaluate({ event: "prompt", state: state(origin), model: "gpt-6-sol", record: false, wiki })).fired.map((e) => e.id);
  const person = await fired("person");
  const agent = await fired("agent");
  for (const id of habits) {
    assert.ok(person.includes(id), `${id} fires on a person's message`);
    assert.ok(!agent.includes(id), `${id} skips an agent's brief`);
  }
});

test("tool: an edit shows Jev only what it adds, and matching context notes arrive together", async () => {
  const id = newSession();
  reset({ "slop/glow": 0.95, "slop/gradient": 0.93 });
  const patch = "*** Begin Patch\n*** Update File: src/Hero.tsx\n@@\n-<h1 className=\"old\">Hi</h1>\n+<h1 className=\"bg-clip-text\">Hi</h1>\n <p>kept</p>\n*** End Patch";
  const result = await onTool({ session_id: id, cwd: tmpdir(), tool_name: "apply_patch", tool_input: { input: patch } });
  assert.equal(calls.at(-1).state.input, "*** Update File: src/Hero.tsx\n<h1 className=\"bg-clip-text\">Hi</h1>", "removed and context lines are not shown");
  assert.match(result.hookSpecificOutput.additionalContext, /Glow blobs\.\*\* Show the product instead\./);
  assert.match(result.hookSpecificOutput.additionalContext, /Gradient text\.\*\* Use one solid color\./);
  assert.deepEqual(Object.keys(result.hookSpecificOutput).sort(), ["additionalContext", "hookEventName"]);
});

test("tool: a context note is added once per session", async () => {
  const id = newSession();
  reset({ "workflow/poll": 0.9 });
  const first = await onTool({ session_id: id, cwd: tmpdir(), tool_name: "Bash", tool_input: { command: "while true; do sleep 5; done" } });
  assert.match(first.hookSpecificOutput.additionalContext, /Polling\.\*\* Wait on the process instead\./);
  assert.equal(await onTool({ session_id: id, cwd: tmpdir(), tool_name: "Bash", tool_input: { command: "sleep 30" } }), null);
});

test("tool: a plain read no entry asks about is counted in the log, without its input", async () => {
  const id = newSession();
  reset();
  const saved = process.env.JEVIS_WIKI;
  // Only the gated entry applies to Bash here.
  const only = mkdtempSync(join(tmpdir(), "jevis-wiki-gated-"));
  mkdirSync(join(only, "slop"));
  writeFileSync(join(only, "slop", "shell-glow.md"), `---\nevent: tool\nask: Does \`input\` write glow blobs?\nunless: Does \`request\` ask for glow?\ntools: [Bash]\nwhen: { marks.plain_read: false }\naction: context\ntitle: Shell glow\nsource: test\n---\nShow the product.\n`);
  process.env.JEVIS_WIKI = only;
  try {
    assert.equal(await onTool({ session_id: id, cwd: tmpdir(), tool_name: "Bash", tool_input: { command: "git log --oneline -3" } }), null);
    assert.equal(calls.length, 0);
    const row = readLog().filter((r) => r.sessionId === id).at(-1);
    assert.equal(row.skipped, "no entries");
    assert.equal(row.plain_read, true);
    assert.equal(row.input, undefined);
  } finally {
    process.env.JEVIS_WIKI = saved;
  }
});

test("tool: a note saved after Jev answers keeps what other hooks of the session saved meanwhile", async () => {
  const id = newSession();
  // While Jev answers this call, a parallel hook of the same session records a command.
  script = (key) => {
    if (key === "workflow/poll") saveSession(id, { ...loadSession(id), commands: [...(loadSession(id).commands ?? []), "parallel"] });
    return key === "workflow/poll" ? 0.9 : 0.05;
  };
  calls = [];
  const out = await onTool({ session_id: id, cwd: tmpdir(), tool_name: "Bash", tool_input: { command: "while true; do sleep 5; done" } });
  assert.match(out.hookSpecificOutput.additionalContext, /Polling/);
  const saved = loadSession(id);
  assert.ok(saved.commands.includes("parallel"), "the parallel hook's write survives");
  assert.ok(saved.shown["workflow/poll"] !== undefined, "and the note is recorded as shown");
});

test("tool: marks.ran_before is a code fact, so a rerun note waits for the second identical command", async () => {
  const id = newSession();
  reset({ "workflow/rerun": 0.95 });
  assert.equal(await onTool({ session_id: id, cwd: tmpdir(), tool_name: "Bash", tool_input: { command: "npm test" } }), null, "the first run is not a rerun");
  assert.equal(calls.at(-1).state.marks.ran_before, false);
  assert.equal(await onTool({ session_id: id, cwd: tmpdir(), tool_name: "Bash", tool_input: { command: "npm run build" } }), null);
  const again = await onTool({ session_id: id, cwd: tmpdir(), tool_name: "Bash", tool_input: { command: "npm  test" } });
  assert.match(again.hookSpecificOutput.additionalContext, /Rerun\.\*\* Run the focused test\./, "whitespace does not make a new command");
});

test("stop: caps distinct lessons per turn at MAX_STOP_BLOCKS, and resets on the next request", async () => {
  const id = newSession();
  // A private, empty project: in a shared /tmp, other processes' writes count as this turn's edits.
  const cwd = mkdtempSync(join(tmpdir(), "jevis-stop-"));
  setStopFired(["verification/second", "verification/third"].map(stopEntry));
  await onPrompt({ session_id: id, cwd, prompt: "fix the button", model: "gpt-6-sol" });
  const stop = { session_id: id, cwd, model: "gpt-6-sol", last_assistant_message: "Fixed and verified in the browser." };
  const first = await stopWithFired(stop);
  assert.equal(first.decision, "block");
  // The stub supplies two fired entries; the real hook enforces the cap.
  assert.match(first.reason, /Second/);
  assert.match(first.reason, /Third/);
  assert.doesNotMatch(first.reason, /Unseen claim/);
  assert.match(first.reason, /give your complete final answer again/);
  assert.equal(MAX_STOP_BLOCKS, 2);
  // Two entries blocked already: the turn is released.
  assert.equal(await stopWithFired(stop), null);
  await onPrompt({ session_id: id, cwd, prompt: "now the header", model: "gpt-6-sol" });
  assert.ok(await stopWithFired(stop));
});

test("stop: a second blocking output cannot exceed the remaining distinct-lesson budget", async () => {
  const id = newSession();
  const cwd = mkdtempSync(join(tmpdir(), "jevis-stop-budget-"));
  setStopFired([stopEntry("verification/second")]);
  await onPrompt({ session_id: id, cwd, prompt: "fix it", model: "gpt-6-sol" });
  const input = { session_id: id, cwd, last_assistant_message: "Done" };
  assert.match((await stopWithFired(input)).reason, /Second/);
  setStopFired(["verification/third", "verification/fourth"].map(stopEntry));
  const next = await stopWithFired(input);
  assert.match(next.reason, /Third/);
  assert.doesNotMatch(next.reason, /Fourth/);
  assert.equal(loadSession(id).stop.blocked.length, MAX_STOP_BLOCKS);
  assert.equal(await stopWithFired(input), null);
});

test("stop: the evidence comes from the session log, and an entry never blocks twice in a turn", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jevis-claude-"));
  const transcript = join(dir, ".claude", "projects", "p", "t.jsonl");
  mkdirSync(join(transcript, ".."), { recursive: true });
  const now = Date.now();
  const at = (s) => new Date(now + s * 1000).toISOString();
  // An earlier turn, already in the log when the prompt hook runs: its edit must not count as this turn's.
  const earlier = [
    { type: "user", uuid: "u0", timestamp: at(-60), message: { role: "user", content: "rename the footer" } },
    { type: "assistant", uuid: "a0", timestamp: at(-59), message: { model: "claude-opus-5-5", content: [{ type: "tool_use", id: "t0", name: "Edit", input: { file_path: join(dir, "src", "Footer.tsx") } }] } },
    { type: "user", uuid: "u00", timestamp: at(-58), message: { content: [{ type: "tool_result", tool_use_id: "t0", content: "ok" }] } },
  ];
  const rows = [
    { type: "user", uuid: "u1", timestamp: at(1), message: { role: "user", content: "fix the checkout button" } },
    { type: "assistant", uuid: "a1", timestamp: at(2), message: { model: "claude-opus-5-5", content: [{ type: "tool_use", id: "t1", name: "Edit", input: { file_path: join(dir, "src", "Checkout.tsx") } }] } },
    { type: "user", uuid: "u2", timestamp: at(3), message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] } },
    { type: "assistant", uuid: "a2", timestamp: at(4), message: { model: "claude-opus-5-5", content: [{ type: "tool_use", id: "t2", name: "Bash", input: { command: "npm test" } }] } },
    { type: "user", uuid: "u3", timestamp: at(5), message: { content: [{ type: "tool_result", tool_use_id: "t2", content: "pass" }] } },
    { type: "assistant", uuid: "a3", timestamp: at(6), message: { model: "claude-opus-5-5", content: [{ type: "text", text: "Fixed; it works in the browser." }] } },
  ];
  writeFileSync(transcript, `${earlier.map((r) => JSON.stringify(r)).join("\n")}\n`);
  const id = newSession();
  setStopFired([stopEntry("verification/unseen")]);
  await onPrompt({ session_id: id, cwd: dir, prompt: "fix the checkout button", transcript_path: transcript, permission_mode: "default" });
  // The turn is written after the prompt hook, as the harness does.
  appendFileSync(transcript, rows.map((r) => JSON.stringify(r)).join("\n"));
  assert.equal(loadSession(id).model, "claude-opus-5-5");
  // The turn started at the prompt hook; the log's rows are timestamped after it in this fixture.
  const stop = { session_id: id, cwd: dir, transcript_path: transcript, permission_mode: "default", stop_hook_active: false };
  const first = await stopWithFired(stop);
  assert.match(first.reason, /Unseen claim: Run it, then report\./);
  const evidence = stopEvaluations.at(-1).state.evidence;
  assert.equal(evidence.edited, true);
  assert.deepEqual(evidence.files_changed, ["src/Checkout.tsx"], "the earlier turn's Footer.tsx edit is outside this turn");
  assert.deepEqual(evidence.ui_files_changed, ["src/Checkout.tsx"]);
  assert.deepEqual(evidence.actions_after_last_edit, ["exit 0: npm test"]);
  assert.equal(stopEvaluations.at(-1).state.final_message, "Fixed; it works in the browser.");
  assert.equal(await stopWithFired({ ...stop, stop_hook_active: true }), null);
});

test("replay: a Claude prompt with an image keeps its words and names the image, never the bytes", async () => {
  const { readClaudeTranscript } = await import("../src/transcript.mjs");
  const rows = [{ type: "user", uuid: "u1", timestamp: new Date().toISOString(), message: { role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgoAAAA" } }, { type: "text", text: "boxes getting these colored left edges are slop too" }] } }];
  const { items } = readClaudeTranscript(rows);
  const text = items[0].it.content[0].text;
  assert.equal(text, "[Image #1]\nboxes getting these colored left edges are slop too");
  assert.deepEqual(attachmentNames(text), ["Image #1"]);
});

test("turn evidence: facts only, from items after the turn began", () => {
  const items = [
    { t: 1, it: { type: "FileChange", changes: { "/w/old.ts": {} } } },
    { t: 10, it: { type: "FileChange", changes: { "/w/src/a.tsx": {}, "/w/src/a.test.tsx": {} } } },
    { t: 11, it: { type: "CommandExecution", command: ["zsh", "-lc", "pnpm test"], exit_code: 1 } },
    { t: 12, it: { type: "McpToolCall", server: "node_repl", tool: "js", arguments: { title: "Check the form", code: "await tab.goto('http://localhost')" } } },
  ];
  const e = turnEvidence(items, { since: 5, cwd: "/w" });
  assert.deepEqual(e.files_changed, ["src/a.tsx", "src/a.test.tsx"]);
  assert.deepEqual(e.ui_files_changed, ["src/a.tsx"]);
  assert.deepEqual(e.actions_after_last_edit, ["exit 1: pnpm test", "tool node_repl.js Check the form: await tab.goto('http://localhost')"]);
  assert.equal(e.commands_run, 1);
});

test("context facts: harness wrappers, origin, the request under Codex's attachment preamble", () => {
  assert.ok(harnessWritten("<task-notification><task-id>1</task-id>"));
  assert.ok(harnessWritten("  <command-name>/clear</command-name>"));
  assert.ok(!harnessWritten("make <b>this</b> bold"));
  assert.equal(originOf("x", {}), "person");
  assert.equal(originOf("x", { AGENT_CALL_DEPTH: "1" }), "agent");
  assert.equal(originOf("x", { BROKER_JOB_ID: "j" }), "agent");
  assert.equal(originOf("[agent] brief", {}), "agent");
  assert.equal(originOf("[task-broker] brief", {}), "agent", "any bracketed agent or broker tag marks an agent's prompt");
  assert.equal(originOf("[draft] fix the header", {}), "person");
  const codex = "# Files mentioned by the user:\n\n## Screen Shot 1.png: /tmp/a.png\n\n## My request:\nmake it look like this <image name=[Image #1]></image>";
  assert.equal(requestText(codex), "make it look like this");
  assert.deepEqual(attachmentNames(codex), ["Screen Shot 1.png", "Image #1"]);
  assert.deepEqual(attachmentNames("fix this [Image #1] and [Image #2]"), ["Image #1", "Image #2"]);
});

test("the log reader handles any size, reads from an offset, and skips a cut first line", async () => {
  const { readJsonl } = await import("../src/transcript.mjs");
  const dir = mkdtempSync(join(tmpdir(), "jevis-jsonl-"));
  const file = join(dir, "big.jsonl");
  const line = (i) => JSON.stringify({ type: "user", i, pad: "x".repeat(900) });
  // About 11 MB: more than one 8 MB chunk, so rows cross a chunk boundary.
  writeFileSync(file, Array.from({ length: 12000 }, (_, i) => line(i)).join("\n"));
  const all = readJsonl(file);
  assert.equal(all.length, 12000);
  assert.deepEqual([all[0].i, all.at(-1).i], [0, 11999]);
  let from = 0;
  for (let i = 0; i < 100; i += 1) from += Buffer.byteLength(`${line(i)}\n`);
  // At a row's end (what the prompt hook records), the next row is whole and kept.
  assert.equal(readJsonl(file, { from })[0].i, 100);
  from += 5; // five bytes into row 100: that cut row is skipped
  const tail = readJsonl(file, { from });
  assert.equal(tail[0].i, 101);
  // A multibyte character split by the 8 MB chunk boundary is decoded whole.
  const wide = join(dir, "wide.jsonl");
  const head = JSON.stringify({ pad: "x".repeat(8 * 1024 * 1024 - 11) }).length;
  writeFileSync(wide, `${JSON.stringify({ pad: "x".repeat(8 * 1024 * 1024 - 11) })}\n${JSON.stringify({ s: "ab\u{1F600}" })}\n`);
  assert.ok(head < 8 * 1024 * 1024, "the second row starts before the boundary");
  assert.equal(readJsonl(wide).at(-1).s, "ab\u{1F600}");
  assert.equal(readJsonl(file, { keep: (l) => l.includes('"i":7,') }).length, 1);
});

test("an edit that failed or was refused is not evidence of a change, in either harness", async () => {
  const { readClaudeTranscript, readRollout } = await import("../src/transcript.mjs");
  const at = new Date().toISOString();
  const call = (id, file) => ({ type: "assistant", timestamp: at, uuid: `a${id}`, message: { model: "claude-opus-5-5", content: [{ type: "tool_use", id, name: "Edit", input: { file_path: `/p/${file}`, old_string: "a", new_string: "b" } }] } });
  const result = (id, is_error) => ({ type: "user", timestamp: at, uuid: `u${id}`, message: { content: [{ type: "tool_result", tool_use_id: id, is_error, content: is_error ? "Jevis stopped this call." : "ok" }] } });
  const claude = turnEvidence(readClaudeTranscript([call("t1", "refused.html"), result("t1", true), call("t2", "kept.html"), result("t2", false)]).items, { cwd: "/p" });
  assert.deepEqual(claude.files_changed, ["kept.html"]);
  const dir = mkdtempSync(join(tmpdir(), "jevis-codex-"));
  const rollout = join(dir, "rollout.jsonl");
  const change = (id, status, path) => JSON.stringify({ timestamp: at, type: "event_msg", payload: { type: "item_completed", item: { type: "FileChange", id, status, changes: { [path]: { type: "update" } } } } });
  writeFileSync(rollout, [change("c1", "failed", "/p/bad.css"), change("c2", "completed", "/p/good.css")].join("\n"));
  assert.deepEqual(turnEvidence(readRollout(rollout).items, { cwd: "/p" }).files_changed, ["good.css"]);
});



test("the call record keeps each answer as its probability, and JEVIS_RECORD=off keeps none", async () => {
  const file = join(process.env.JEVIS_HOME, "jev", "calls.jsonl");
  const lines = () => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").length : 0);
  reset({ "design/open-page": 0.9 });
  const before = lines();
  await evaluate({ event: "prompt", state: { request: "make a page" }, model: "gpt-6-sol" });
  assert.equal(lines(), before + 1);
  const row = JSON.parse(readFileSync(file, "utf8").trim().split("\n").at(-1));
  assert.equal(row.answers["design/open-page"], 0.9);
  assert.ok(Object.values(row.answers).every((a) => typeof a === "number"));
  const version = JSON.parse(readFileSync(join(process.env.JEVIS_HOME, "jev", "questions", `${row.version}.json`), "utf8"));
  assert.equal(version["design/open-page"].type, "noul", "each answer's type is in its question set");
  process.env.JEVIS_RECORD = "off";
  try {
    await evaluate({ event: "prompt", state: { request: "make a page" }, model: "gpt-6-sol" });
    assert.equal(lines(), before + 1);
  } finally {
    delete process.env.JEVIS_RECORD;
  }
});

test("Jevis's home is private (0700) even when something else created it open", { skip: process.platform === "win32" && "POSIX permissions do not exist on Windows" }, () => {
  const saved = process.env.JEVIS_HOME;
  const open = mkdtempSync(join(tmpdir(), "jevis-open-home-"));
  chmodSync(open, 0o755);
  process.env.JEVIS_HOME = open;
  try {
    ensureDir("sessions");
    assert.equal(statSync(open).mode & 0o777, 0o700);
    assert.equal(statSync(join(open, "sessions")).mode & 0o777, 0o700);
  } finally {
    process.env.JEVIS_HOME = saved;
  }
});

test("a question set's version changes with its questions, not their order", () => {
  const a = { x: { type: "noul", instructions: "a" }, y: { type: "noul", instructions: "b" } };
  const b = { y: a.y, x: a.x };
  assert.equal(questionsVersion(a), questionsVersion(b));
  assert.notEqual(questionsVersion(a), questionsVersion({ ...a, x: { type: "noul", instructions: "c" } }));
});

test("stop: critic off with edits ignores model-judged blocks and makes zero transport calls", async () => {
  const saved = process.env.JEVIS_CRITIC;
  process.env.JEVIS_CRITIC = "off";
  try {
    reset(() => 0.99);
    const id = newSession();
    const cwd = mkdtempSync(join(tmpdir(), "jevis-stop-off-"));
    await onPrompt({ session_id: id, cwd, prompt: "fix the button", model: "gpt-6-sol" });
    await onTool({ session_id: id, cwd, tool_name: "Write", tool_input: { file_path: "button.tsx", content: "export const Button = () => null" } });
    calls = [];
    assert.equal(await onStop({ session_id: id, cwd, last_assistant_message: "Done and verified." }), null);
    assert.equal(calls.length, 0);
    const row = readLog().filter((r) => r.sessionId === id && r.event === "stop").at(-1);
    assert.equal(row.evidence.edited, true);
    assert.equal(row.evidence.files, 1);
    assert.deepEqual(row.acted, []);
    assert.deepEqual(loadSession(id).stop.blocked, []);
  } finally {
    if (saved === undefined) delete process.env.JEVIS_CRITIC;
    else process.env.JEVIS_CRITIC = saved;
  }
});
