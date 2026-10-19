import { AXES, axisKey } from "./axes.mjs";
import { inputMarks } from "./context.mjs";
import { askJev } from "./jev.mjs";
import { codeDecision } from "./rules.mjs";
import { candidates, conditionsHold, factsHold, loadWiki } from "./wiki.mjs";

/**
 * One event through code and Jev: the axes (the profile) and unresolved entries'
 * question go out in one call. Model-decided entries ask their exceptions in
 * a second call only after clearing `min` and `when`, on the same deadline.
 * Code decides what happens next; Jev only answers.
 */

/** The question Jev is asked for an entry, and (unlessQuestion) for its `unless`: `jevis stats --near` compares recorded wordings against these. */
export const question = (e) => ({ type: "noul", instructions: e.ask, ...(e.yes || e.no ? { criteria: { true: e.yes ?? "Yes", false: e.no ?? "No" } } : {}) });
export const unlessQuestion = (e) => ({ type: "noul", instructions: e.unless });
const round = (n) => Math.round(n * 1000) / 1000;
/** An entry's `unless` question: asked apart from `ask`, because Jev reads one literal condition better than a compound one. */
export const unlessKey = (id) => `${id}#unless`;

export async function evaluate({ event, state, tool = null, model = null, harness = null, sessionId = null, timeoutMs = 3000, record = true, wiki = loadWiki(), axes = true, codeOnly = false, local = false }) {
  // Every caller (the hook, replay, `jevis ask`, the batteries) sees the same code facts about a tool call;
  // a caller's own marks (the hook's ran_before) win, and a mark it leaves out is still computed, never undefined.
  if (event === "tool") state = { ...state, marks: { ...inputMarks(state.input, { tool }), ...state.marks } };
  // An entry whose facts already fail cannot fire, so it is not asked: a plain read asks nothing.
  let pool = candidates(wiki.entries, { event, tool, model }).filter((e) => factsHold(e.when, { event, state }));
  // A tool call no entry could apply to costs no call at all.
  if (event === "tool" && !pool.length) return { skipped: "no entries", profile: {}, scores: {}, fired: [], ms: 0 };
  const code = {};
  for (const e of pool) {
    if (!e.decide) continue;
    const v = codeDecision(e.decide, { ...state, tool: tool ?? state.tool });
    if (v !== null) code[e.id] = v;
  }
  // codeOnly: an entry code cannot settle is dropped, never sent to the model.
  if (codeOnly) pool = pool.filter((e) => e.id in code);
  // local (worker sessions): no model call at all. Only entries code settles
  // outright run; one with an `unless` stands down rather than asking Jev.
  if (local) {
    pool = pool.filter((e) => e.id in code && !e.unless);
    axes = false;
  }
  const questions = {};
  // Preserve the diagnostic profile on model-reviewed events, but don't call
  // Jev solely to log axes when code has settled every lesson and its gates.
  const needsModel = event !== "tool" || pool.some((e) => !(e.id in code) || code[e.id] && e.unless);
  if (axes) for (const [id, q] of Object.entries(AXES[event] ?? {})) {
    if (needsModel || pool.some((e) => code[e.id] && id in (e.when ?? {}))) questions[axisKey(id)] = q;
  }
  for (const e of pool) {
    if (!(e.id in code)) questions[e.id] = question(e);
    if (e.unless && code[e.id] === true) questions[unlessKey(e.id)] = unlessQuestion(e);
  }
  const started = Date.now();
  let jevQuestions = Object.keys(questions).length;
  const { answers, ms, error, errorClass } = jevQuestions ? await askJev({ state, questions, event, sessionId, harness, model, timeoutMs, record }) : { answers: {}, ms: 0 };
  // An unavailable exception must never turn a code match into an action.
  if (!answers) return { error, errorClass, profile: {}, scores: {}, unless: {}, fired: [], ms, code, jevQuestions };
  const value = (a) => (typeof a?.noul === "number" ? a.noul : null);
  const profile = {};
  for (const id of Object.keys(AXES[event] ?? {})) {
    const v = value(answers[axisKey(id)]);
    if (v !== null) profile[id] = round(v);
  }
  const scores = {};
  const unless = {};
  for (const e of pool) {
    const v = e.id in code ? Number(code[e.id]) : value(answers[e.id]);
    if (v !== null) scores[e.id] = round(v);
    const u = e.unless && code[e.id] === true ? value(answers[unlessKey(e.id)]) : null;
    if (u !== null) unless[e.id] = round(u);
  }
  const exceptions = Object.fromEntries(pool
    .filter((e) => !(e.id in code) && e.unless && (scores[e.id] ?? 0) >= e.min && conditionsHold(e.when, { profile, state }))
    .map((e) => [unlessKey(e.id), unlessQuestion(e)]));
  const unlessCalls = Object.keys(exceptions).length ? 1 : 0;
  if (unlessCalls) {
    jevQuestions += Object.keys(exceptions).length;
    const result = await askJev({ state, questions: exceptions, event, sessionId, harness, model, timeoutMs: Math.max(1, timeoutMs - (Date.now() - started)), record });
    // Missing/failed exception answers stand down only these entries, not the
    // whole event. The default below treats an unavailable exception as applied.
    for (const e of pool) {
      if (!(unlessKey(e.id) in exceptions)) continue;
      const u = value(result.answers?.[unlessKey(e.id)]);
      if (u !== null) unless[e.id] = round(u);
    }
  }
  const holds = (e) => (scores[e.id] ?? 0) >= e.min && (!e.unless || (unless[e.id] ?? 1) < e.unless_max) && conditionsHold(e.when, { profile, state });
  const fired = pool.filter(holds).sort((a, b) => scores[b.id] - scores[a.id]);
  return { profile, scores, unless, fired, ms: jevQuestions ? Date.now() - started : 0, pool: pool.length, code, jevQuestions, unlessCalls };
}
