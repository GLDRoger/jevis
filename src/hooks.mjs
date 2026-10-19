import { clip, commandKey, harnessOf, harnessWritten, hookItem, inputMarks, isWorkerPrompt, lastAgentMessage, lastUserMessageAt, mergeToolResults, museTool, originOf, requestText, sessionItems, TEST_PATH, toolInput, transcriptSize, turnEvidence, turnTexts, UI_FILE, withTouched, workspaceOf } from "./context.mjs";
import { evaluate } from "./engine.mjs";
import { criticBackend, formatReview, review, roundsFor } from "./review.mjs";
import { loadSession, log, saveSession } from "./state.mjs";
import { wikiFor } from "./wiki.mjs";
import { insideFolder, splitFolders } from "./paths.mjs";
import { errorMessage, outageLine } from "./health.mjs";
import { RESULT_MEMORY, toolResult } from "./post.mjs";
import { nudgeText } from "./nudges.mjs";

/**
 * The hooks. Every one fails open: no Jev, no key, a timeout, or a bug
 * means the agent carries on untouched. Tool hooks only add context;
 * the code-decided Stop check and optional design review can send work back.
 *
 * Limits learned from an earlier hook system, which once held a session for hours over one wrong block:
 * - a context note is given once per session (again after the context is compacted);
 * - a stop block names an entry at most once per turn, with at most MAX_STOP_BLOCKS distinct lessons per turn;
 * - every note says the user's instructions win.
 */

export const MAX_NOTES = 4;
export const NOTE_BUDGET = 3000;
export const MAX_STOP_BLOCKS = 2;
/** The model name used for Claude Code before its transcript names one: in the claude family. */
export const CLAUDE_UNKNOWN = "claude-unknown";
/** How many distinct commands a session remembers for marks.ran_before. */
export const COMMAND_MEMORY = 60;
// Tool calls kept per turn for harnesses without a transcript.
export const HOOK_ITEM_MEMORY = 200;
export const HOOK_ITEM_CLIP = 4000;
/** How many earlier messages a tool check can read, and how much of each. */
const EARLIER_MEMORY = 8;
const EARLIER_CLIP = 400;
export const TIMEOUTS = { prompt: 3000, tool: 1500, stop: 3000 };

const timeout = (event) => Number(process.env.JEVIS_TIMEOUT_MS) || TIMEOUTS[event];
const shadow = () => process.env.JEVIS_MODE === "shadow";

/** JEVIS_DISABLE silences every hook; JEVIS_SCOPE (platform-separated folders) limits them to those folders and everything inside them. */
export function inScope(cwd, { platform = process.platform, delimiter = platform === "win32" ? ";" : ":" } = {}) {
  if (process.env.JEVIS_DISABLE) return false;
  const scope = process.env.JEVIS_SCOPE;
  if (!scope) return true;
  if (!cwd) return false;
  // A folder, not a string prefix: /projects/app does not cover /projects/application. macOS reports /tmp as /private/tmp.
  if (platform === "win32") return splitFolders(scope, delimiter).some((p) => insideFolder(cwd, p, platform));
  const within = (dir) => dir === "" || insideFolder(cwd, dir, platform);
  return splitFolders(scope, delimiter).map((p) => p.replace(/\/+$/, "")).some((p) => within(p) || within(`/private${p}`));
}

const summary = (r) => ({ ms: r.ms, error: r.error ?? undefined, errorClass: r.errorClass ?? undefined, skipped: r.skipped ?? undefined, pool: r.pool, profile: r.profile, code: r.code, jevQuestions: r.jevQuestions, fired: r.fired.map((e) => ({ id: e.id, p: r.scores[e.id] })) });

function sessionOutage(session) {
  if (session.outageShown) return null;
  const line = outageLine();
  if (line) session.outageShown = true;
  return line;
}

/** Nudges never judge or block; even their loading and bookkeeping fail open. */
function nudgeContext(hook, sessionId, harness, model, session) {
  try {
    if (shadow()) return "";
    const { ids, text } = nudgeText(hook, model);
    if (!text) return "";
    if (hook === "ui-edit") {
      const now = loadSession(sessionId);
      if (now.turn !== session.turn || now.nudged?.uiEdit === session.turn) return "";
      now.nudged = { ...now.nudged, uiEdit: session.turn };
      if (!saveSession(sessionId, now)) return "";
    }
    if (hook === "search") {
      // Once per session; a compaction or clear resets it, since the earlier tip is gone from context.
      const now = loadSession(sessionId);
      if (now.nudged?.search) return "";
      now.nudged = { ...now.nudged, search: true };
      if (!saveSession(sessionId, now)) return "";
    }
    log({ event: "nudge", sessionId, harness, model, hook, ids, turn: session.turn });
    return text;
  } catch { return ""; }
}

function uiEditNudge(tool, rawInput, sessionId, harness, session) {
  try {
    const item = hookItem(tool, rawInput ?? {});
    if (item?.type !== "FileChange" || !item.changes.some(({ path }) => UI_FILE.test(path) && !TEST_PATH.test(path.replaceAll("\\", "/")))) return "";
    return nudgeContext("ui-edit", sessionId, harness, session.model, session);
  } catch { return ""; }
}

/** A shell command that searches with grep or find, as a command word (not `git grep`, not an argument). */
export const LEGACY_SEARCH = /(?:^|[;&|(`]|\$\(|\bxargs(?:\s+-\S+)*)\s*(?:sudo\s+)?(?:[ef]?grep|find)\s/;
function searchNudge(tool, shown, sessionId, harness, session) {
  try {
    if (tool !== "Bash" || !LEGACY_SEARCH.test(shown)) return "";
    return nudgeContext("search", sessionId, harness, session.model, session);
  } catch { return ""; }
}

/** Notes that fit the budget, strongest first, each at most once per session. */
function pickNotes(fired, session, limit = MAX_NOTES) {
  const out = [];
  let used = 0;
  for (const e of fired) {
    if (e.action !== "context" || session.shown[e.id] !== undefined) continue;
    const size = e.title.length + e.body.length + 8;
    if (out.length >= limit || used + size > NOTE_BUDGET) break;
    out.push(e);
    used += size;
  }
  return out;
}

const formatNotes = (notes, lead) => [lead, ...notes.map((e) => `**${e.title}.** ${e.body}`)].join("\n\n");

/**
 * Short feedback that says something missed without saying what: "not good",
 * "try again", "doesn't fit what I had in mind". The whole message has to be
 * the complaint: a negative word inside a longer instruction ("this doesn't
 * work for X, so do Y"), a question, or a conditional ("if I'm not wrong") is
 * not vague feedback. A replay over 4,637 logged prompts (Oct 2026) found 9
 * matches under the old rule, 8 of them false. Code only; every match is
 * logged as a feedback nudge, so misses and false matches show up in review.
 */
const VAGUE = /\b(?:not (?:good|great|right|it|quite|there|like (?:this|that)|what i (?:wanted|meant|asked for|had in mind))|(?:doesn'?t|does not|didn'?t|did not|isn'?t|is not) (?:fit|work|look right|feel right|match|land|it|right)(?! (?:for|on|with|in|when|if|because|since|unless|at|yet)\b)|try again|try something else|start over|redo it|do it again|still (?:wrong|broken|bad|not (?:it|right|good))|that'?s not it|no+pe|meh|nah|(?<!not )wrong|worse|ugly|hate it|not a fan|missed the point)\b/;
const VAGUE_MAX_WORDS = 8;
export function isVagueFeedback(text) {
  const t = String(text ?? "").replace(/\[image #\d+\]/gi, "").trim().toLowerCase().replaceAll("\u2019", "'");
  if (!t || t.length > 150 || t.includes("?")) return false;
  return t.split(/\s+/).length <= VAGUE_MAX_WORDS && VAGUE.test(t);
}

/** UserPromptSubmit: profile the request and hand over the lessons that match it. */
export async function onPrompt(input) {
  const { session_id: sessionId, cwd, prompt } = input;
  if (!inScope(cwd) || harnessWritten(prompt)) return null;
  const { harness, model } = harnessOf(input);
  const session = loadSession(sessionId);
  const outage = sessionOutage(session);
  const request = clip(requestText(prompt), 2000);
  if ((session.turn === 0 && isWorkerPrompt(prompt)) || originOf("", process.env) === "agent") session.worker = true;
  Object.assign(session, {
    previousRequest: session.request,
    // Tool notes can read the recent conversation, not just its latest request.
    earlierRequests: session.request ? [...(session.earlierRequests ?? []), clip(session.request, EARLIER_CLIP)].slice(-EARLIER_MEMORY) : session.earlierRequests ?? [],
    request,
    // The design review judges a follow-up against what the conversation set out to build.
    firstRequest: session.firstRequest ?? request,
    turn: session.turn + 1,
    turnStartedAt: Date.now(),
    // Harnesses without a transcript (Muse Code): this turn's tool calls, recorded by the tool hook.
    hookItems: [],
    hookResults: [],
    turnId: input.turn_id ?? null,
    // Where this turn begins in the transcript: the Stop hook reads from here, not the whole log.
    transcriptOffset: transcriptSize(input.transcript_path),
    // Claude Code's hooks never name the model, and its transcript has none before the first reply.
    // It runs Claude models, so claude-family entries still apply on a session's first turn.
    model: model ?? session.model ?? (harness === "Claude Code" ? CLAUDE_UNKNOWN : null),
  });
  if (!saveSession(sessionId, session)) return null;
  // v2: no lesson notes and no decision-model call on prompts. A month of
  // real use (Sep 28 - Oct 18 2026) showed 0 of 60 sampled notes changed an
  // outcome the agent's own instruction files would not have produced; the
  // place for a standing lesson is AGENTS.md / CLAUDE.md, not a runtime note.
  // The hook stays for the session bookkeeping the tool and stop hooks read.
  log({ event: "prompt", worker: session.worker || undefined, sessionId, harness, model: session.model, origin: originOf(prompt), turn: session.turn, cwd, request: clip(session.request, 200), acted: [], mode: shadow() ? "shadow" : "live" });
  if (shadow()) return null;
  // Vague feedback after an agent turn: the first gets the feedback tip, later ones in the session the stronger one.
  let feedback = "";
  if (!session.worker && session.turn > 1 && isVagueFeedback(request)) {
    const seen = session.vagueFeedback ?? 0;
    feedback = nudgeContext(seen ? "feedback-repeat" : "feedback", sessionId, harness, session.model, session);
    const now = loadSession(sessionId);
    now.vagueFeedback = seen + 1;
    saveSession(sessionId, now);
  }
  const additionalContext = [outage, session.worker ? "" : nudgeContext("prompt", sessionId, harness, session.model, session), feedback, session.worker ? nudgeContext("worker", sessionId, harness, session.model, session) : ""].filter(Boolean).join("\n\n");
  return additionalContext ? { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext } } : null;
}

/** Pre-tool hooks record attempts, not execution success. Keep bounded
 * calls as fallback evidence, independently of RECORD.
 */
function rememberTool(input, tool, rawInput, key) {
  const now = loadSession(input.session_id);
  let changed = false;
  if (!input.transcript_path) {
    const item = hookItem(tool, rawInput ?? {});
    if (item) {
      if (item.type === "CommandExecution") item.command = clip(item.command, HOOK_ITEM_CLIP);
      if (item.type === "FileChange") item.changes = item.changes.slice(0, 20).map((c) => ({ path: clip(c.path, 200) }));
      if (item.type === "McpToolCall") {
        item.server = clip(item.server, 100);
        item.tool = clip(item.tool, 100);
        const args = JSON.stringify(item.arguments);
        if (args.length > HOOK_ITEM_CLIP) item.arguments = { code: clip(args, HOOK_ITEM_CLIP) };
      }
      Object.assign(item, { attempted: true, id: input.tool_use_id ?? undefined });
      now.hookItems = [...(now.hookItems ?? []), { t: Date.now(), it: item }].slice(-HOOK_ITEM_MEMORY);
      changed = true;
    }
  }
  if (key && !(now.commands ?? []).includes(key)) {
    now.commands = [...(now.commands ?? []), key].slice(-COMMAND_MEMORY);
    changed = true;
  }
  if (changed) saveSession(input.session_id, now);
}

/** PostToolUse (and Claude's PostToolUseFailure): local, bounded facts only.
 * No network or wiki loading, no output/decision, including on disk failure.
 */
export function onPost(input) {
  try {
    if (!input.session_id || !inScope(input.cwd)) return null;
    const row = toolResult(input);
    if (!row) return null;
    const session = loadSession(input.session_id);
    if (row.turnId && session.turnId && row.turnId !== session.turnId) return null;
    const prior = session.hookResults ?? [];
    session.hookResults = mergeToolResults(prior, [row]).slice(-RESULT_MEMORY);
    saveSession(input.session_id, session);
  } catch { /* post hooks always fail open */ }
  return null;
}

/** PreToolUse: add a matching context note or a design tip, never change the call. */
export async function onTool(input) {
  const { session_id: sessionId, cwd } = input;
  const { harness } = harnessOf(input, { withModel: false });
  const { tool, input: rawInput } = harness === "Muse Code" ? museTool(input.tool_name, input.tool_input) : { tool: input.tool_name, input: input.tool_input };
  if (!inScope(cwd) || !tool) return null;
  const session = loadSession(sessionId);
  const shown = toolInput(tool, rawInput);
  const key = tool === "Bash" ? commandKey(shown) : null;
  const commands = session.commands ?? [];
  const state = { request: session.request ?? "", earlier_requests: session.earlierRequests ?? [], tool, input: shown, marks: inputMarks(shown, { tool, ranBefore: key !== null && commands.includes(key) }), workspace: workspaceOf(cwd) };
  const result = session.worker
    ? { skipped: "worker", fired: [] }
    : await evaluate({ event: "tool", state, tool, model: session.model, harness, sessionId, timeoutMs: timeout("tool"), wiki: wikiFor(cwd) });
  if (result.skipped) {
    // Logged without the input: a skipped call is counted by `jevis stats`, not judged.
    log({ event: "tool", worker: session.worker || undefined, sessionId, harness, turn: session.turn, tool, skipped: result.skipped, plain_read: state.marks.plain_read || undefined });
  }
  const notes = pickNotes(result.fired, session, 2);
  if (!result.skipped) log({ event: "tool", worker: session.worker || undefined, sessionId, harness, turn: session.turn, tool, input: clip(state.input, 200), subagent: input.agent_id ? true : undefined, ...summary(result), acted: notes.map((e) => e.id), mode: shadow() ? "shadow" : "live" });
  if (shadow()) {
    rememberTool(input, tool, rawInput, key);
    return null;
  }
  rememberTool(input, tool, rawInput, key);
  if (notes.length) {
    // Re-read before writing: other hooks of this session (parallel tool calls, subagents) may have saved while Jev answered.
    const now = loadSession(sessionId);
    for (const e of notes) now.shown[e.id] = session.turn;
    if (!saveSession(sessionId, now)) return null;
  }
  const additionalContext = [notes.length ? formatNotes(notes, "Jevis, before this call:") : "", uiEditNudge(tool, rawInput, sessionId, harness, session), searchNudge(tool, shown, sessionId, harness, session)].filter(Boolean).join("\n\n");
  return additionalContext ? { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext } } : null;
}

/** Stop: send the agent back once per lesson when its final message and the turn's evidence match a block entry. */
export async function onStop(input) {
  const { session_id: sessionId, cwd } = input;
  if (!inScope(cwd)) return null;
  const session = loadSession(sessionId);
  if (session.stop.turn !== session.turn) session.stop = { turn: session.turn, blocked: [], reviews: 0 };
  session.stop.reviews ??= 0;
  const wikiSpent = session.stop.blocked.length >= MAX_STOP_BLOCKS;
  if (wikiSpent && session.stop.reviews >= roundsFor(session)) return null;
  // Only this turn's bytes: logs reach gigabytes. Without a recorded offset, the last 64 MB.
  const from = session.transcriptOffset ?? Math.max(0, transcriptSize(input.transcript_path) - 64 * 1024 * 1024);
  const items = mergeToolResults(sessionItems(input.transcript_path, { from, since: session.turnStartedAt ?? 0 }) ?? session.hookItems ?? [], session.hookResults ?? []);
  const final = input.last_assistant_message ?? lastAgentMessage(items);
  if (!final) return null;
  const { harness } = harnessOf(input, { withModel: false });
  const since = session.turnStartedAt ?? lastUserMessageAt(items);
  const state = { request: session.request ?? "", final_message: clip(final, 3000), evidence: withTouched(turnEvidence(items ?? [], { since, cwd }), cwd, session.turnStartedAt, items) };
  // v2: only code-decided stop entries may block. Model-judged stop blocks
  // caught 4 real problems in a month against 54 harmful blocks (audit,
  // Oct 18 2026). The decision model is asked only for the review's axes,
  // and only when a review could run at all.
  const reviewPossible = !session.worker && criticBackend() !== "off" && session.stop.reviews < roundsFor(session) && (state.evidence.ui_files_changed.length > 0 || state.evidence.files_changed_count > 0);
  const result = await evaluate({ event: "stop", state, model: session.model, harness, sessionId, timeoutMs: timeout("stop"), wiki: wikiFor(cwd), codeOnly: true, axes: reviewPossible, local: Boolean(session.worker) });
  const blocks = wikiSpent ? [] : result.fired.filter((e) => e.action === "block" && !session.stop.blocked.includes(e.id)).slice(0, MAX_STOP_BLOCKS - session.stop.blocked.length);
  log({ event: "stop", worker: session.worker || undefined, sessionId, harness, turn: session.turn, final: clip(final, 200), evidence: { edited: state.evidence.edited, files: state.evidence.files_changed_count, ui_files: state.evidence.ui_files_changed.length, after: state.evidence.actions_after_last_edit.length }, ...summary(result), acted: blocks.map((e) => e.id), mode: shadow() ? "shadow" : "live" });
  if (!blocks.length) return session.worker ? null : reviewTurn({ input, session, sessionId, cwd, harness, state, profile: result.profile, items, since, final });
  if (shadow()) return null;
  session.stop.blocked.push(...blocks.map((e) => e.id));
  const now = loadSession(sessionId);
  if (now.turn !== session.turn) return null;
  now.stop = session.stop;
  if (!saveSession(sessionId, now)) return null;
  return {
    decision: "block",
    reason: [
      "Jevis, before you finish:",
      ...blocks.map((e) => `- ${e.title}: ${e.body}`),
      "Fix this. If it does not apply to what the user asked, give your complete final answer again and add one line on why this check does not apply: your last message is what the user or the calling agent reads.",
    ].join("\n"),
  };
}

/**
 * The design and film review: after the wiki passes a turn of visual work that
 * changed interface files and says the work is done, render it and let the
 * critic judge it. Its "now A, instead X" list goes back as a block, at most
 * roundsFor(session) times a turn.
 *
 * A progress report is not reviewed. An agent orchestrating background workers
 * ends many turns with "still building": in the maintainer's log (Sep 28 2026),
 * every reviewed turn of finished work scored claims_done 0.75 to 0.97, and
 * every progress report 0.03 to 0.21. Two progress reports were reviewed
 * anyway: the critic judged a half-built film by its blank frames and sent the
 * orchestrator 7 fixes for work its workers had not finished.
 */
export const REVIEW_CLAIMS_DONE = 0.5;
async function reviewTurn({ input, session, sessionId, cwd, harness, state, profile, items, since, final }) {
  const film = (profile.film ?? 0) >= 0.6;
  const rounds = roundsFor(session);
  const due =
    session.stop.reviews < rounds &&
    criticBackend() !== "off" &&
    (profile.work_requested ?? 0) >= 0.6 &&
    (profile.claims_done ?? 0) >= REVIEW_CLAIMS_DONE &&
    ((profile.visual ?? 0) >= 0.6 || film) &&
    (film ? state.evidence.files_changed_count > 0 : state.evidence.ui_files_changed.length > 0);
  if (!due) return null;
  const base = { event: "review", sessionId, harness, turn: session.turn, round: session.stop.reviews + 1 };
  if (shadow()) {
    log({ ...base, skipped: "shadow mode" });
    return null;
  }
  const round = session.stop.reviews + 1;
  let r;
  try {
    r = await review({ kind: film ? "film" : "page", sessionId, turn: session.turn, round, of: rounds, cwd, request: session.request ?? "", firstRequest: session.firstRequest !== session.request ? session.firstRequest : null, files: state.evidence.files_changed, texts: [...turnTexts(items ?? [], { since }), final], shown: session.shown });
  } catch (e) {
    r = { error: errorMessage(e) };
  }
  log({ ...base, kind: r.kind, targets: r.targets, ms: r.ms, verdict: r.verdict?.verdict, items: r.verdict?.must_fix?.length, skipped: r.skipped, error: r.error, facts: r.facts });
  // A round counts once it rendered something, so a broken critic cannot hold the turn forever.
  if (r.skipped) return null;
  const now = loadSession(sessionId);
  now.stop = { ...session.stop, reviews: round };
  now.firstReviewTurn ??= session.turn;
  if (!saveSession(sessionId, now)) return null;
  if (r.error || r.verdict?.verdict !== "fix") return null;
  return { decision: "block", reason: formatReview(r, round, rounds) };
}

/** SessionStart and PostCompact: after a compaction or a clear, earlier notes are gone from the agent's context, so they may be given again. */
export function onSession(input) {
  const { session_id: sessionId, cwd } = input;
  const source = input.source ?? (input.hook_event_name === "PostCompact" ? "compact" : "startup");
  if (!sessionId || !inScope(cwd)) return null;
  const session = loadSession(sessionId);
  if (source === "compact" || source === "clear") {
    session.shown = {};
    if (session.nudged) session.nudged.search = false;
    if (source === "clear") {
      session.vagueFeedback = 0;
    }
    log({ event: "session", sessionId, source, reset: true });
  }
  const outage = input.hook_event_name === "PostCompact" ? null : sessionOutage(session);
  if (!saveSession(sessionId, session)) return null;
  const nudge = input.hook_event_name !== "PostCompact" && ["startup", "resume", "clear", "compact"].includes(source)
    ? (() => {
      const { harness } = harnessOf(input, { withModel: false });
      // Claude Code's SessionStart may not name the model; it runs Claude models, so Claude's design list applies.
      return nudgeContext("session", sessionId, harness, input.model ?? session.model ?? (harness === "Claude Code" ? CLAUDE_UNKNOWN : null), session);
    })() : "";
  const additionalContext = [outage, nudge].filter(Boolean).join("\n\n");
  return additionalContext ? { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } } : null;
}
