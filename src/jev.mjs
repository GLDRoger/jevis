import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { redactDeep } from "./redact.mjs";
import { ensureDir, jevisHome } from "./state.mjs";
import { errorClass, errorMessage, recordHealth } from "./health.mjs";

/**
 * Yes/no decisions over HTTPS: TypeSafe's Jev (or a compatible server), or
 * GPT-6 Luna through OpenAI's Decisions API. Callers use Jev's noul contract
 * for both; the Luna transport translates predicates and probabilities.
 *
 * Questions in one call are answered in parallel against a state that is billed
 * once, so the count barely moves latency: measured Sep 27 2026, 1 question
 * 330 ms, 250 questions 360 ms, 500 questions 2-4 s. Jevis sends every entry's
 * question at once and splits past CHUNK into parallel calls.
 *
 * Both deciders' calls are recorded (~/.jevis/jev/calls.jsonl, question sets
 * in ~/.jevis/jev/questions/). Laya training exports keep only Jev labels.
 */

/**
 * Where the yes/no questions go. TypeSafe's hosted Jev by default; any server
 * that speaks the same POST /v1/systemone protocol works, such as a self-hosted
 * Laya (`laya-serve`): set JEVIS_JEV_URL to its full endpoint.
 */
export const TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone";
export const LUNA_URL = "https://api.openai.com/v1/decisions";
export const decider = (env = process.env) => env.JEVIS_DECIDER === "luna" ? "luna" : "jev";
export const jevUrl = () => process.env.JEVIS_JEV_URL?.trim() || TYPESAFE_URL;
export const jevModel = () => process.env.JEVIS_JEV_MODEL?.trim() || (jevUrl() === TYPESAFE_URL ? "jev-1.14.0" : undefined);
export const lunaModel = (env = process.env) => env.JEVIS_LUNA_MODEL?.trim() || "gpt-6-luna";
export const CHUNK = 200;
/** Jev and Luna use 200; laya-serve refuses more than 64. JEVIS_JEV_CHUNK overrides. */
export const chunkSize = () => Number(process.env.JEVIS_JEV_CHUNK) || (decider() === "luna" || jevUrl() === TYPESAFE_URL ? CHUNK : 64);

/** Shared by transport, doctor, and installer. Never print the key. */
export function lunaKey(env = process.env) {
  for (const source of ["JEVIS_LUNA_KEY", "OPENAI_API_KEY"]) {
    if (env[source]?.trim()) return { key: env[source].trim(), source };
  }
  const source = join(jevisHome(), "secrets", "openai_api_key");
  const key = existsSync(source) ? readFileSync(source, "utf8").trim() : "";
  return key ? { key, source } : null;
}

/** JEVIS_JEV_KEY, else TYPESAFE_API_KEY, else ~/.jevis/secrets/typesafe_api_key. */
function apiKey() {
  const env = process.env.JEVIS_JEV_KEY ?? process.env.TYPESAFE_API_KEY;
  if (env?.trim()) return env.trim();
  const file = join(jevisHome(), "secrets", "typesafe_api_key");
  return existsSync(file) ? readFileSync(file, "utf8").trim() : null;
}

/** Hosted deciders need keys; self-hosted Jev servers may run without one. */
const needsKey = () => decider() === "luna" || jevUrl() === TYPESAFE_URL;

async function httpTransport(body, timeoutMs, signal) {
  const key = apiKey();
  if (!key && jevUrl() === TYPESAFE_URL) throw new Error("no TypeSafe API key");
  return post(jevUrl(), body, key, timeoutMs, signal);
}

async function post(url, body, key, timeoutMs, signal) {
  const res = await fetch(url, {
    method: "POST",
    headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
  });
  const raw = await res.text();
  let json;
  try { json = JSON.parse(raw); } catch { json = { detail: raw.trim() || res.statusText }; }
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}: ${errorMessage(json, res.statusText)}`), { status: res.status });
  return json;
}

let lunaUrl = LUNA_URL;
/** Tests exercise the real transport against a local HTTP server. No user URL setting. */
export const setLunaUrl = (url) => { lunaUrl = url ?? LUNA_URL; };

export async function lunaTransport(body, timeoutMs, signal) {
  const questions = Object.entries(body.questions).map(([name, q]) => {
    if (q.type !== "noul") throw new Error(`Luna supports only noul questions: ${name} has type ${q.type}`);
    const instructions = q.instructions + (q.criteria ? ` Yes means: ${q.criteria.true}. No means: ${q.criteria.false}.` : "");
    return { type: "predicate", name, instructions };
  });
  const key = lunaKey();
  if (!key) throw new Error("no OpenAI API key");
  const response = await post(lunaUrl, { model: body.model ?? lunaModel(), input: JSON.stringify(body.state), questions }, key.key, timeoutMs, signal);
  if (!Array.isArray(response.answers)) throw new Error(errorMessage(response.error, "no answers"));
  return {
    answers: Object.fromEntries(response.answers.filter((a) => a.type !== "refusal" && typeof a.probability === "number").map((a) => [a.name, { noul: a.probability }])),
    usage: { input_tokens: response.usage?.input_tokens ?? 0, output_tokens: response.usage?.output_tokens ?? 0 },
  };
}

/**
 * Both hosted deciders have long latency tails. Luna's Oct 15 2026 median was
 * 383 ms and max 1574 ms for 66 questions. Jev, Sep 27: median 390 ms,
 * but 1.2, 1.8, 3.3, and 4.2 s among them. In a slow spell, about half of the
 * identical requests took 4-15 s while the rest answered in under a second. A
 * slow call is a slow server, not a slow question, so identical requests race:
 * one now and one at each HEDGES delay, and the first answer wins while the rest
 * are aborted. With two requests, 6% of 360 simulated-session calls still
 * timed out (1.5 s budget); a third brings that to about p^3. Tokens cost $0.042
 * per million, so the duplicates are free in practice.
 */
export const HEDGES = [350, 750];
export function hedged(send, body, timeoutMs, hedges = HEDGES) {
  return new Promise((resolve, reject) => {
    const controllers = [];
    const timers = [];
    const started = Date.now();
    let settled = false;
    let failures = 0;
    let launched = 0;
    const planned = 1 + hedges.filter((ms) => ms < timeoutMs).length;
    const finish = (fn, value) => {
      settled = true;
      timers.forEach(clearTimeout);
      controllers.forEach((c) => c.abort());
      fn(value);
    };
    const launch = () => {
      if (settled || launched >= planned) return;
      const controller = new AbortController();
      controllers.push(controller);
      launched += 1;
      // One deadline for the whole call: a hedge gets only the time that is left.
      const left = Math.max(1, timeoutMs - (Date.now() - started));
      send(body, left, controller.signal).then(
        (value) => {
          if (settled) return;
          controllers.splice(controllers.indexOf(controller), 1);
          finish(resolve, value);
        },
        (error) => {
          if (settled) return;
          failures += 1;
          // A fast failure launches the next request at once instead of waiting for its slot.
          if (failures >= planned) finish(reject, error);
          else if (launched === failures) launch();
        },
      );
    };
    for (const ms of hedges) if (ms < timeoutMs) timers.push(setTimeout(launch, ms));
    launch();
  });
}

let transport = null;
/** Tests replace the network with (body, timeoutMs) => response. */
export const setJevTransport = (fn) => {
  transport = fn;
};

export const jevAvailable = () => process.env.JEVIS_JEV !== "off" && (decider() === "luna" ? lunaKey() !== null : transport !== null || !needsKey() || apiKey() !== null);

/** A question set's version: recorded answers are only comparable within one version. */
export const questionsVersion = (questions) => createHash("sha256").update(JSON.stringify(Object.keys(questions).sort().map((k) => [k, questions[k]]))).digest("hex").slice(0, 12);

/**
 * Answers are recorded as { id: probability }: each question's type is in
 * questions/<version>.json, and the full answer objects were over half of
 * every record. An answer that is not a noul is kept whole.
 */
export const compactAnswers = (answers) => answers && Object.fromEntries(Object.entries(answers).map(([k, a]) => [k, typeof a?.noul === "number" ? a.noul : a]));

/** JEVIS_RECORD=off keeps no call record at all. */
const recording = () => process.env.JEVIS_RECORD?.trim().toLowerCase() !== "off";

function record(entry, questions) {
  try {
    const dir = ensureDir("jev");
    const qdir = ensureDir("jev", "questions");
    const qfile = join(qdir, `${entry.version}.json`);
    if (!existsSync(qfile)) writeFileSync(qfile, JSON.stringify(questions), { mode: 0o600 });
    appendFileSync(join(dir, "calls.jsonl"), `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  } catch {
    /* recording never breaks a hook */
  }
}

const chunks = (questions) => {
  const keys = Object.keys(questions);
  const out = [];
  const size = chunkSize();
  for (let i = 0; i < keys.length; i += size) out.push(Object.fromEntries(keys.slice(i, i + size).map((k) => [k, questions[k]])));
  return out;
};

/**
 * Ask the active decider every question about one state. Returns { answers, ms, error }:
 * answers is null when it is off, unconfigured, slow, or failing, and the
 * caller then does nothing (Jevis fails open).
 */
export async function askJev({ state, questions, event, sessionId = null, harness = null, model = null, timeoutMs = 3000, record: keep = true }) {
  if (!Object.keys(questions).length) return { answers: {}, ms: 0, error: null };
  if (!jevAvailable()) return { answers: null, ms: 0, error: "jev unavailable" };
  const started = Date.now();
  const clean = redactDeep(state);
  const provider = decider();
  const decisionModel = provider === "luna" ? lunaModel() : jevModel();
  let answers = null;
  let error = null;
  let usage = { input_tokens: 0, output_tokens: 0 };
  try {
    const responses = await Promise.all(chunks(questions).map((qs) => hedged(transport ?? (provider === "luna" ? lunaTransport : httpTransport), { state: clean, ...(decisionModel ? { model: decisionModel } : {}), questions: qs }, timeoutMs, transport || !needsKey() ? [] : HEDGES)));
    answers = {};
    for (const r of responses) {
      if (!r?.answers) throw new Error(errorMessage(r?.error, "no answers"));
      Object.assign(answers, r.answers);
      usage.input_tokens += r.usage?.input_tokens ?? 0;
      usage.output_tokens += r.usage?.output_tokens ?? 0;
    }
  } catch (e) {
    answers = null;
    error = e?.name === "TimeoutError" ? `timeout after ${timeoutMs} ms` : errorMessage(e);
  }
  const ms = Date.now() - started;
  const version = questionsVersion(questions);
  const failureClass = error ? errorClass(error) : null;
  if (keep) recordHealth(error);
  if (keep && recording()) record({ at: new Date(started).toISOString(), event, version, sessionId, harness, model, decider: provider, deciderModel: decisionModel ?? null, ms, state: clean, answers: compactAnswers(answers), usage, error, errorClass: failureClass }, questions);
  return { answers, ms, error, errorClass: failureClass };
}
