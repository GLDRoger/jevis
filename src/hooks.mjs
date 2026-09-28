import { attachmentNames, clip, commandKey, harnessOf, harnessWritten, inputMarks, lastAgentMessage, lastUserMessageAt, originOf, requestText, sessionItems, toolInput, transcriptSize, turnEvidence, turnTexts, withTouched, workspaceOf } from "./context.mjs";
import { evaluate } from "./engine.mjs";
import { redact } from "./redact.mjs";
import { criticBackend, designLaw, formatReview, review, roundsFor } from "./review.mjs";
import { freshSession, loadSession, log, saveSession } from "./state.mjs";

/**
 * The four hooks. Every one fails open: no Jev, no key, a timeout, or a bug
 * means the agent carries on untouched.
 *
 * Limits learned from an earlier hook system, which once held a session for hours over one wrong block:
 * - a context note is given once per session (again after the context is compacted);
 * - a stop block names an entry at most once per turn, and a turn is blocked at most MAX_STOP_BLOCKS times;
 * - every note says the user's instructions win.
 */

export const MAX_NOTES = 4;
export const NOTE_BUDGET = 3000;
export const MAX_STOP_BLOCKS = 2;
export const MAX_DENIES = 3;
/** The model name used for Claude Code before its transcript names one: in the claude family. */
export const CLAUDE_UNKNOWN = "claude-unknown";
/** How many distinct commands a session remembers for marks.ran_before. */
export const COMMAND_MEMORY = 60;
export const TIMEOUTS = { prompt: 3000, tool: 1500, stop: 3000 };

const timeout = (event) => Number(process.env.JEVIS_TIMEOUT_MS) || TIMEOUTS[event];
const shadow = () => process.env.JEVIS_MODE === "shadow";

/** JEVIS_DISABLE silences every hook; JEVIS_SCOPE (colon-separated path prefixes) limits them to those folders. */
export function inScope(cwd) {
  if (process.env.JEVIS_DISABLE) return false;
  const scope = process.env.JEVIS_SCOPE;
  if (!scope) return true;
  return scope.split(":").filter(Boolean).some((p) => cwd?.startsWith(p) || cwd?.startsWith(`/private${p}`));
}

const summary = (r) => ({ ms: r.ms, error: r.error ?? undefined, skipped: r.skipped ?? undefined, pool: r.pool, profile: r.profile, fired: r.fired.map((e) => ({ id: e.id, p: r.scores[e.id] })) });

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

/** UserPromptSubmit: profile the request and hand over the lessons that match it. */
export async function onPrompt(input) {
  const { session_id: sessionId, cwd, prompt } = input;
  if (!inScope(cwd) || harnessWritten(prompt)) return null;
  const { harness, model } = harnessOf(input);
  const session = loadSession(sessionId);
  // Stored masked: session files sit on disk, and everything downstream reads the request from here.
  const request = clip(redact(requestText(prompt)), 2000);
  Object.assign(session, {
    previousRequest: session.request,
    request,
    // The design review judges a follow-up against what the conversation set out to build.
    firstRequest: session.firstRequest ?? request,
    turn: session.turn + 1,
    turnStartedAt: Date.now(),
    // Where this turn begins in the transcript: the Stop hook reads from here, not the whole log.
    transcriptOffset: transcriptSize(input.transcript_path),
    // Claude Code's hooks never name the model, and its transcript has none before the first reply.
    // It runs Claude models, so claude-family entries still apply on a session's first turn.
    model: model ?? session.model ?? (harness === "Claude Code" ? CLAUDE_UNKNOWN : null),
  });
  saveSession(sessionId, session);
  const state = {
    request: session.request,
    previous_request: session.previousRequest ? clip(session.previousRequest, 600) : null,
    attachments: attachmentNames(prompt),
    workspace: workspaceOf(cwd),
    agent: { harness, model: session.model, origin: originOf(prompt) },
    // Whether this user keeps a design law file (see designLaw in review.mjs).
    user: { design_law: designLaw() !== null },
  };
  const result = await evaluate({ event: "prompt", state, model: session.model, harness, sessionId, timeoutMs: timeout("prompt") });
  const notes = pickNotes(result.fired, session);
  log({ event: "prompt", sessionId, harness, model: session.model, turn: session.turn, cwd, request: clip(session.request, 200), ...summary(result), acted: notes.map((e) => e.id), mode: shadow() ? "shadow" : "live" });
  if (!notes.length || shadow()) return null;
  const now = loadSession(sessionId);
  for (const e of notes) now.shown[e.id] = session.turn;
  saveSession(sessionId, now);
  return {
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: formatNotes(notes, "Jevis: lessons from past sessions where requests like this went wrong. Use what fits; where the user's instructions differ, theirs win."),
    },
  };
}

function denyReason(denies) {
  const lines = denies.length === 1
    ? [`Jevis stopped this call. ${denies[0].title}: ${denies[0].body}`]
    : ["Jevis stopped this call:", ...denies.map((e) => `- ${e.title}: ${e.body}`)];
  lines.push("Redo the call without this. If the user explicitly asked for exactly this, tell them why it was stopped and let them run it.");
  return lines.join("\n");
}

/** PreToolUse: refuse a call a deny entry matches; otherwise add a note the first time one applies. */
export async function onTool(input) {
  const { session_id: sessionId, cwd, tool_name: tool } = input;
  if (!inScope(cwd) || !tool) return null;
  const session = loadSession(sessionId);
  const { harness } = harnessOf(input, { withModel: false });
  const shown = toolInput(tool, input.tool_input);
  const key = tool === "Bash" ? commandKey(shown) : null;
  const commands = session.commands ?? [];
  const state = { request: session.request ?? "", tool, input: shown, marks: inputMarks(shown, { ranBefore: key !== null && commands.includes(key) }), workspace: workspaceOf(cwd) };
  if (key && !commands.includes(key)) {
    session.commands = [...commands, key].slice(-COMMAND_MEMORY);
    saveSession(sessionId, session);
  }
  const result = await evaluate({ event: "tool", state, tool, model: session.model, harness, sessionId, timeoutMs: timeout("tool") });
  if (result.skipped) return null;
  // Every matching deny goes back at once: an edit with three slop patterns should be fixed in one retry, not three.
  const denies = result.fired.filter((e) => e.action === "deny").slice(0, MAX_DENIES);
  const notes = denies.length ? [] : pickNotes(result.fired, session, 2);
  log({ event: "tool", sessionId, harness, turn: session.turn, tool, input: clip(state.input, 200), subagent: input.agent_id ? true : undefined, ...summary(result), acted: denies.length ? denies.map((e) => e.id) : notes.map((e) => e.id), mode: shadow() ? "shadow" : "live" });
  if (shadow()) return null;
  if (denies.length) {
    return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: denyReason(denies) } };
  }
  if (!notes.length) return null;
  for (const e of notes) session.shown[e.id] = session.turn;
  saveSession(sessionId, session);
  return { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: formatNotes(notes, "Jevis, before this call:") } };
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
  const items = sessionItems(input.transcript_path, { from, since: session.turnStartedAt ?? 0 });
  const final = input.last_assistant_message ?? lastAgentMessage(items);
  if (!final) return null;
  const { harness } = harnessOf(input, { withModel: false });
  const since = session.turnStartedAt ?? lastUserMessageAt(items);
  const state = { request: session.request ?? "", final_message: clip(final, 3000), evidence: withTouched(turnEvidence(items ?? [], { since, cwd }), cwd, session.turnStartedAt) };
  const result = await evaluate({ event: "stop", state, model: session.model, harness, sessionId, timeoutMs: timeout("stop") });
  const blocks = wikiSpent ? [] : result.fired.filter((e) => e.action === "block" && !session.stop.blocked.includes(e.id)).slice(0, 2);
  log({ event: "stop", sessionId, harness, turn: session.turn, final: clip(final, 200), evidence: { edited: state.evidence.edited, files: state.evidence.files_changed_count, ui_files: state.evidence.ui_files_changed.length, after: state.evidence.actions_after_last_edit.length }, ...summary(result), acted: blocks.map((e) => e.id), mode: shadow() ? "shadow" : "live" });
  if (!blocks.length) return reviewTurn({ input, session, sessionId, cwd, harness, state, profile: result.profile, items, since, final });
  if (shadow()) return null;
  session.stop.blocked.push(...blocks.map((e) => e.id));
  saveSession(sessionId, session);
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
 * changed interface files, render it and let the critic judge it. Its "now A,
 * instead X" list goes back as a block, at most roundsFor(session) times a turn.
 */
async function reviewTurn({ input, session, sessionId, cwd, harness, state, profile, items, since, final }) {
  const film = (profile.film ?? 0) >= 0.6;
  const rounds = roundsFor(session);
  const due =
    session.stop.reviews < rounds &&
    criticBackend() !== "off" &&
    (profile.work_requested ?? 0) >= 0.6 &&
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
    r = { error: e.message.slice(0, 200) };
  }
  log({ ...base, kind: r.kind, targets: r.targets, ms: r.ms, verdict: r.verdict?.verdict, items: r.verdict?.must_fix?.length, skipped: r.skipped, error: r.error, facts: r.facts });
  // A round counts once it rendered something, so a broken critic cannot hold the turn forever.
  if (r.skipped) return null;
  const now = loadSession(sessionId);
  now.stop = { ...session.stop, reviews: round };
  now.firstReviewTurn ??= session.turn;
  saveSession(sessionId, now);
  if (r.error || r.verdict?.verdict !== "fix") return null;
  return { decision: "block", reason: formatReview(r, round, rounds) };
}

/** SessionStart and PostCompact: after a compaction or a clear, earlier notes are gone from the agent's context, so they may be given again. */
export function onSession(input) {
  const { session_id: sessionId } = input;
  const source = input.source ?? (input.hook_event_name === "PostCompact" ? "compact" : "startup");
  if (!sessionId) return null;
  const session = loadSession(sessionId);
  if (source === "compact" || source === "clear") {
    saveSession(sessionId, { ...session, shown: {} });
    log({ event: "session", sessionId, source, reset: true });
  } else if (source === "startup" && session.turn === 0) {
    saveSession(sessionId, freshSession());
  }
  return null;
}
