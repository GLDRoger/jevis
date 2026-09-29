import { existsSync } from "node:fs";
import { join } from "node:path";
import { axisKey } from "./axes.mjs";
import { clip } from "./context.mjs";
import { redact } from "./redact.mjs";
import { jevisHome } from "./state.mjs";
import { eachJsonl } from "./transcript.mjs";

/**
 * `jevis mine`: the turns a person corrected, as raw material for new
 * lessons. Every prompt is already scored on the `correction` axis, so the
 * record holds each "no, that's not what I asked" with the answer it was
 * about. A habit that shows up across sessions is a lesson; the skill
 * (skills/jevis/SKILL.md) turns one into a wiki entry.
 *
 * Reads the Jev call record for the full texts. With JEVIS_RECORD=off there
 * is none, and the decision log's shorter excerpts are used instead.
 */

export const CORRECTION_MIN = 0.6;

const noulOf = (a) => (typeof a === "number" ? a : typeof a?.noul === "number" ? a.noul : null);

/** Corrections from the call record: each with the request before it and the agent's last answer in between. */
function fromCalls(file, { since, min, agents }) {
  const sessions = new Map();
  const out = [];
  eachJsonl(file, (r) => {
    // Rows before `since` still set the scene: a correction just after it needs the request and answer just before.
    if (!r.sessionId || !r.answers) return;
    const s = sessions.get(r.sessionId) ?? {};
    sessions.set(r.sessionId, s);
    if (r.event === "stop") {
      s.stop = { at: r.at, final: r.state?.final_message ?? "" };
      return;
    }
    const correction = noulOf(r.answers[axisKey("correction")]);
    const origin = r.state?.agent?.origin ?? "person";
    if (correction !== null && correction >= min && (agents || origin === "person") && s.prompt && !(since && Date.parse(r.at) < since)) {
      const answered = s.stop && s.stop.at > s.prompt.at;
      out.push({ at: r.at, sessionId: r.sessionId, harness: r.harness, model: r.model, origin, correction, request: r.state?.request ?? "", before: s.prompt.request, final: answered ? s.stop.final : null, turnFrom: s.prompt.at });
    }
    s.prompt = { at: r.at, request: r.state?.request ?? "" };
  }, { keep: (line) => line.includes('"event":"prompt"') || line.includes('"event":"stop"') });
  return out;
}

/** The same from the decision log: requests and answers clipped to 200 characters, no origin. */
function fromLog(file, { since, min }) {
  const sessions = new Map();
  const out = [];
  eachJsonl(file, (r) => {
    if (!r.sessionId) return;
    const s = sessions.get(r.sessionId) ?? {};
    sessions.set(r.sessionId, s);
    if (r.event === "stop" && r.final) s.stop = { at: r.at, final: r.final };
    if (r.event !== "prompt" || !r.profile) return;
    const correction = r.profile.correction;
    if (typeof correction === "number" && correction >= min && s.prompt && !(since && Date.parse(r.at) < since)) {
      const answered = s.stop && s.stop.at > s.prompt.at;
      out.push({ at: r.at, sessionId: r.sessionId, harness: r.harness, model: r.model, origin: null, correction, request: r.request ?? "", before: s.prompt.request, final: answered ? s.stop.final : null, turnFrom: s.prompt.at });
    }
    s.prompt = { at: r.at, request: r.request ?? "" };
  });
  return out;
}

/** What Jevis did in each corrected turn: notes given, calls refused, stops blocked. */
function withActions(corrections, logFile) {
  const bySession = new Map(corrections.map((c) => [c.sessionId, []]));
  if (!bySession.size) return corrections;
  eachJsonl(logFile, (r) => {
    const rows = bySession.get(r.sessionId);
    if (rows && r.acted?.length && r.mode !== "shadow") rows.push({ at: r.at, event: r.event, acted: r.acted });
  });
  return corrections.map((c) => {
    const acted = bySession.get(c.sessionId).filter((r) => r.at >= c.turnFrom && r.at < c.at);
    const verb = { prompt: "noted", tool: "refused or noted", stop: "blocked on" };
    return { ...c, jevis: acted.map((r) => `${verb[r.event] ?? r.event} ${r.acted.join(", ")}`) };
  });
}

/** Corrected turns, oldest first, the last `limit` of them. */
export function mine({ since = 0, min = CORRECTION_MIN, agents = false, limit = 30, home = jevisHome() } = {}) {
  const calls = join(home, "jev", "calls.jsonl");
  const logFile = join(home, "log.jsonl");
  const source = existsSync(calls) ? "calls" : "log";
  const found = source === "calls" ? fromCalls(calls, { since, min, agents }) : fromLog(logFile, { since, min });
  const masked = (c) => ({ ...c, request: redact(c.request), before: redact(c.before), final: c.final === null ? null : redact(c.final) });
  return { source, total: found.length, corrections: withActions(found.slice(-limit), logFile).map(({ turnFrom, ...c }) => masked(c)) };
}

/** Masked again on the way out: a record written before a masking rule was added can hold what today's rules catch. */
const quote = (text, n) => clip(redact(String(text ?? "")).replace(/\s+/g, " ").trim(), n);

export function formatMine({ source, total, corrections }) {
  if (!corrections.length) return "No corrected turns found. Try --since further back, --min lower, or --agents to include requests from other agents.";
  const lines = [
    `# Corrected turns: ${corrections.length}${total > corrections.length ? ` most recent of ${total}` : ""}`,
    "",
    "Each is a turn where the next request corrected, complained about, or rejected the agent's work. A habit that repeats across sessions is a lesson; a one-off usually is not. To turn one into a lesson, follow skills/jevis/SKILL.md: write it to ~/.jevis/wiki/<area>/<name>.md as WIKI.md describes, then check it fires on the request below with jevis ask.",
    ...(source === "log" ? ["", "(From the decision log: no call record, so texts are cut to 200 characters.)"] : []),
  ];
  corrections.forEach((c, i) => {
    lines.push("", `## ${i + 1}. ${c.at.slice(0, 16).replace("T", " ")} · ${c.harness ?? "unknown harness"} · ${c.model ?? "unknown model"} · correction ${c.correction.toFixed(2)}${c.origin && c.origin !== "person" ? ` · from ${c.origin}` : ""}`);
    lines.push("", `**Asked:** ${quote(c.before, 400)}`);
    lines.push(`**Agent answered:** ${c.final ? quote(c.final, 700) : "(no final answer recorded)"}`);
    lines.push(`**Then:** ${quote(c.request, 700)}`);
    lines.push(`**Jevis that turn:** ${c.jevis?.length ? c.jevis.join("; ") : "nothing"}`);
  });
  return lines.join("\n");
}
