import { existsSync, readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { join } from "node:path";
import { AXES, axisKey } from "./axes.mjs";
import { inputMarks } from "./context.mjs";
import { question, unlessKey, unlessQuestion } from "./engine.mjs";
import { jevisHome } from "./state.mjs";
import { eachJsonl } from "./transcript.mjs";
import { applies, conditionsHold, enabled, factsHold } from "./wiki.mjs";

/**
 * `jevis stats --near`: each lesson against every recorded Jev answer to
 * its current question, so a threshold is tuned from real sessions instead
 * of a guess. For each entry: how often it was asked, how often it fires
 * under today's rules (min, unless, when), how often it came within 0.1 of
 * firing, and how often `unless` or `when` stood a high score down.
 *
 * Only calls the entry would be asked about today count (its tools, model
 * family, and facts such as marks.plain_read), and only answers to the
 * question as it is worded now: a reworded `ask` is a different question,
 * and its old answers are reported as stale.
 */

export const NEAR = 0.1;

const valueOf = (a) => (typeof a === "number" ? a : typeof a?.noul === "number" ? a.noul : null);

/** `7d`, `12h`, or a date: the earliest record to read. */
export function sinceTime(text, now = Date.now()) {
  if (!text) return 0;
  const m = String(text).match(/^(\d+)([dh])$/);
  if (m) return now - Number(m[1]) * (m[2] === "d" ? 86_400_000 : 3_600_000);
  const t = Date.parse(text);
  if (Number.isNaN(t)) throw new Error(`--since takes 7d, 12h, or a date, got ${text}`);
  return t;
}

/** Per-entry tallies over the call record. `file` and `questionsDir` default to ~/.jevis/jev. */
export function tune(all, { file = join(jevisHome(), "jev", "calls.jsonl"), questionsDir = join(jevisHome(), "jev", "questions"), since = 0 } = {}) {
  const sets = new Map();
  const questionSet = (version) => {
    if (!sets.has(version)) {
      const f = join(questionsDir, `${version}.json`);
      let qs = null;
      try {
        qs = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
      } catch {
        /* an unreadable set counts its answers as stale */
      }
      sets.set(version, qs);
    }
    return sets.get(version);
  };
  // As the engine: an optional entry that is off is never asked, so it cannot fire today.
  const entries = all.filter((e) => enabled(e));
  const off = all.filter((e) => !enabled(e)).map((e) => e.id);
  const byEvent = {};
  const rows = {};
  for (const e of entries) {
    (byEvent[e.event] ??= []).push(e);
    rows[e.id] = { id: e.id, event: e.event, action: e.action, min: e.min, asked: 0, fires: 0, near: 0, stoodDown: 0, stale: 0, scores: [] };
  }
  // Each entry's current wording, compared once per version rather than once per record.
  const current = new Map();
  const sameQuestion = (version, qs, key, want) => {
    const k = `${version}\0${key}`;
    if (!current.has(k)) current.set(k, qs !== null && isDeepStrictEqual(qs[key], want));
    return current.get(k);
  };
  let records = 0;
  // A quick look at each line before parsing it: most records are tool calls, and a
  // record is only parsed when its event has entries and it is inside the window.
  const events = Object.keys(byEvent);
  eachJsonl(file, (r) => {
    if (!r.answers || r.error || !byEvent[r.event]) return;
    if (since && Date.parse(r.at) < since) return;
    records += 1;
    const qs = questionSet(r.version);
    const profile = {};
    for (const id of Object.keys(AXES[r.event] ?? {})) {
      const v = valueOf(r.answers[axisKey(id)]);
      if (v !== null) profile[id] = v;
    }
    // The facts as the hook would compute them today; only ran_before (this session's earlier commands) is taken from the record.
    const state = r.event === "tool" ? { ...r.state, marks: inputMarks(r.state?.input ?? "", { tool: r.state?.tool, ranBefore: r.state?.marks?.ran_before === true }) } : r.state;
    for (const e of byEvent[r.event]) {
      const p = valueOf(r.answers[e.id]);
      // Only calls the entry would be asked about today: its tools, model family, and facts, whatever they were then.
      if (p === null || !applies(e, { event: r.event, tool: r.state?.tool ?? null, model: r.model }) || !factsHold(e.when, { event: r.event, state })) continue;
      const row = rows[e.id];
      // Either question reworded (or an unless added since) means today's answer is unknown.
      const u = e.unless ? valueOf(r.answers[unlessKey(e.id)]) : null;
      if (!sameQuestion(r.version, qs, e.id, question(e)) || (e.unless && (u === null || !sameQuestion(r.version, qs, unlessKey(e.id), unlessQuestion(e))))) {
        row.stale += 1;
        continue;
      }
      row.asked += 1;
      row.scores.push(p);
      if (p < e.min) {
        if (p >= e.min - NEAR) row.near += 1;
        continue;
      }
      if ((e.unless && u >= e.unless_max) || !conditionsHold(e.when, { profile, state })) row.stoodDown += 1;
      else row.fires += 1;
    }
  }, { keep: (line) => events.some((ev) => line.includes(`"event":"${ev}"`)) });
  const out = Object.values(rows).map(({ scores, ...row }) => {
    scores.sort((a, b) => a - b);
    return { ...row, max: scores.at(-1) ?? null, p95: scores.length ? scores[Math.min(scores.length - 1, Math.floor(scores.length * 0.95))] : null };
  });
  return { records, entries: out, off };
}

const fmt = (n) => (n === null ? "  -  " : n.toFixed(2));

/** The table `jevis stats --near` prints: entries that fire or come close first, then the ones never asked. */
export function formatTune({ records, entries, off = [] }) {
  const asked = entries.filter((e) => e.asked).sort((a, b) => b.fires - a.fires || b.near - a.near || (b.max ?? 0) - (a.max ?? 0));
  const width = Math.max(5, ...asked.map((e) => e.id.length));
  const lines = [`${records} recorded decisions. fires: would fire under today's rules; near: within ${NEAR} of min; stood down: cleared min, stopped by unless or when.`, ""];
  lines.push(`${"entry".padEnd(width)}  asked  fires  near  stood down   max   p95   min`);
  for (const e of asked) lines.push(`${e.id.padEnd(width)}  ${String(e.asked).padStart(5)}  ${String(e.fires).padStart(5)}  ${String(e.near).padStart(4)}  ${String(e.stoodDown).padStart(10)}  ${fmt(e.max)}  ${fmt(e.p95)}  ${fmt(e.min)}`);
  const never = entries.filter((e) => !e.asked);
  if (never.length) lines.push("", `Not asked in its current wording (new, reworded, or never a candidate): ${never.map((e) => e.id).join(", ")}`);
  if (off.length) lines.push(`Optional and off (JEVIS_ENABLE turns them on): ${off.join(", ")}`);
  const stale = entries.reduce((n, e) => n + e.stale, 0);
  if (stale) lines.push(`${stale} answers to earlier wordings were left out.`);
  return lines.join("\n");
}
