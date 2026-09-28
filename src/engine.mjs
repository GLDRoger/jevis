import { AXES, axisKey } from "./axes.mjs";
import { askJev } from "./jev.mjs";
import { candidates, conditionsHold, loadWiki } from "./wiki.mjs";

/**
 * One event through Jev: the axes (the profile) and every candidate entry's
 * question go out in a single call; an entry fires when its answer clears its
 * `min` and its `when` holds. Code decides what happens next; Jev only answers.
 */

const question = (e) => ({ type: "noul", instructions: e.ask, ...(e.yes || e.no ? { criteria: { true: e.yes ?? "Yes", false: e.no ?? "No" } } : {}) });
const round = (n) => Math.round(n * 1000) / 1000;
/** An entry's `unless` question: asked apart from `ask`, because Jev reads one literal condition better than a compound one. */
const unlessKey = (id) => `${id}#unless`;

export async function evaluate({ event, state, tool = null, model = null, harness = null, sessionId = null, timeoutMs = 3000, record = true, wiki = loadWiki(), axes = true }) {
  const pool = candidates(wiki.entries, { event, tool, model });
  // A tool call no entry could apply to costs no call at all.
  if (event === "tool" && !pool.length) return { skipped: "no entries", profile: {}, scores: {}, fired: [], ms: 0 };
  const questions = {};
  if (axes) for (const [id, q] of Object.entries(AXES[event] ?? {})) questions[axisKey(id)] = q;
  for (const e of pool) {
    questions[e.id] = question(e);
    if (e.unless) questions[unlessKey(e.id)] = { type: "noul", instructions: e.unless };
  }
  const { answers, ms, error } = await askJev({ state, questions, event, sessionId, harness, model, timeoutMs, record });
  if (!answers) return { error, profile: {}, scores: {}, fired: [], ms };
  const value = (a) => (typeof a?.noul === "number" ? a.noul : null);
  const profile = {};
  for (const id of Object.keys(AXES[event] ?? {})) {
    const v = value(answers[axisKey(id)]);
    if (v !== null) profile[id] = round(v);
  }
  const scores = {};
  const unless = {};
  for (const e of pool) {
    const v = value(answers[e.id]);
    if (v !== null) scores[e.id] = round(v);
    const u = e.unless ? value(answers[unlessKey(e.id)]) : null;
    if (u !== null) unless[e.id] = round(u);
  }
  const holds = (e) => (scores[e.id] ?? 0) >= e.min && (!e.unless || (unless[e.id] ?? 1) < e.unless_max) && conditionsHold(e.when, { profile, state });
  const fired = pool.filter(holds).sort((a, b) => scores[b.id] - scores[a.id]);
  return { profile, scores, unless, fired, ms, pool: pool.length };
}
