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
 * Full texts come from the Jev call record. Turns without a call record,
 * including ones after JEVIS_RECORD=off, use the decision log's excerpts.
 */

export const CORRECTION_MIN = 0.6;

const noulOf = (a) => (typeof a === "number" ? a : typeof a?.noul === "number" ? a.noul : null);

/** Merge the prompt and stop timelines before finding corrections, so recording gaps do not lose their context. */
function fromRecords(callsFile, logFile, { since, min, agents }) {
  const sessions = new Map();
  const add = (r, source) => {
    if (!r.sessionId || !["prompt", "stop"].includes(r.event)) return;
    if (source === "log" && r.request === undefined && r.final === undefined) return;
    const t = Date.parse(r.at);
    if (!Number.isFinite(t)) return;
    const rows = sessions.get(r.sessionId) ?? [];
    sessions.set(r.sessionId, rows);
    rows.push({ at: r.at, t, event: r.event, sessionId: r.sessionId, harness: r.harness, model: r.model, source, ms: r.ms ?? 0,
      origin: source === "calls" ? r.state?.agent?.origin ?? "person" : r.origin ?? null,
      correction: source === "calls" ? noulOf(r.answers?.[axisKey("correction")]) : noulOf(r.profile?.correction),
      text: source === "calls" ? (r.event === "prompt" ? r.state?.request : r.state?.final_message) ?? "" : (r.event === "prompt" ? r.request : r.final) ?? "" });
  };
  eachJsonl(callsFile, (r) => add(r, "calls"));
  eachJsonl(logFile, (r) => add(r, "log"));
  const out = [];
  for (const rows of sessions.values()) {
    rows.sort((a, b) => a.t - b.t || (a.source === b.source ? 0 : a.source === "calls" ? -1 : 1));
    const calls = {};
    const turns = [];
    for (const r of rows) {
      if (r.source === "calls") calls[r.event] = r;
      else {
        const call = calls[r.event];
        // The log follows the call's completion. Its text may be clipped or masked differently, so it is not a turn id.
        if (call && r.t >= call.t && r.t <= call.t + call.ms + 1000 && (!call.harness || !r.harness || call.harness === r.harness)) {
          call.correction ??= r.correction;
          call.harness ??= r.harness;
          call.model ??= r.model;
          call.turnAt = r.at;
          delete calls[r.event];
          continue;
        }
      }
      turns.push(r);
    }
    let prompt;
    let stop;
    for (const r of turns) {
      if (r.event === "stop") { stop = r; continue; }
      // Earlier rows still set the scene for a correction just after --since.
      if (r.correction !== null && r.correction >= min && (agents || !r.origin || r.origin === "person") && prompt && !(since && r.t < since)) {
        const answered = stop && stop.t >= prompt.t;
        const excerpts = [];
        if (r.source === "log") excerpts.push("then");
        if (prompt.source === "log") excerpts.push("asked");
        if (answered && stop.source === "log") excerpts.push("agent answered");
        out.push({ at: r.at, sessionId: r.sessionId, harness: r.harness, model: r.model, origin: r.origin, correction: r.correction, source: r.source, excerpts, request: r.text, before: prompt.text, final: answered ? stop.text : null, turnFrom: prompt.turnAt ?? prompt.at });
      }
      prompt = r;
      stop = null;
    }
  }
  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
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
  const found = fromRecords(calls, logFile, { since, min, agents });
  const hasCalls = found.some((c) => c.source === "calls");
  const hasLog = found.some((c) => c.source === "log");
  const source = hasCalls && hasLog ? "mixed" : hasLog ? "log" : existsSync(calls) ? "calls" : "log";
  const masked = (c) => ({ ...c, request: redact(c.request), before: redact(c.before), final: c.final === null ? null : redact(c.final) });
  return { source, total: found.length, corrections: withActions(limit > 0 ? found.slice(-limit) : [], logFile).map(({ turnFrom, ...c }) => masked(c)) };
}

/** Masked again on the way out: a record written before a masking rule was added can hold what today's rules catch. */
const quote = (text, n) => clip(redact(String(text ?? "")).replace(/\s+/g, " ").trim(), n);

export function formatMine({ source, total, corrections }) {
  if (!corrections.length) return "No corrected turns found. Try --since further back, --min lower, or --agents to include requests from other agents.";
  const lines = [
    `# Corrected turns: ${corrections.length}${total > corrections.length ? ` most recent of ${total}` : ""}`,
    "",
    "Each is a turn where the next request corrected, complained about, or rejected the agent's work. A habit that repeats across sessions is a lesson; a one-off usually is not. To turn one into a lesson, follow skills/jevis/SKILL.md: write it to ~/.jevis/wiki/<area>/<name>.md as WIKI.md describes, then check it fires on the request below with jevis ask.",
    ...(source !== "calls" ? ["", "(Decision-log excerpts are cut to 200 characters; each affected turn is marked below.)"] : []),
  ];
  corrections.forEach((c, i) => {
    lines.push("", `## ${i + 1}. ${c.at.slice(0, 16).replace("T", " ")} · ${c.harness ?? "unknown harness"} · ${c.model ?? "unknown model"} · correction ${c.correction.toFixed(2)}${c.origin && c.origin !== "person" ? ` · from ${c.origin}` : ""}`);
    if (c.excerpts?.length) lines.push("", `(Decision-log excerpts, cut to 200 characters: ${c.excerpts.join(", ")}.)`);
    lines.push("", `**Asked:** ${quote(c.before, 400)}`);
    lines.push(`**Agent answered:** ${c.final ? quote(c.final, 700) : "(no final answer recorded)"}`);
    lines.push(`**Then:** ${quote(c.request, 700)}`);
    lines.push(`**Jevis that turn:** ${c.jevis?.length ? c.jevis.join("; ") : "nothing"}`);
  });
  return lines.join("\n");
}
