import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { redactDeep } from "./redact.mjs";
import { ensureDir, jevisHome } from "./state.mjs";

/**
 * TypeSafe's Jev: typed yes/no, choice, and score answers with calibrated
 * probabilities, over one HTTPS call.
 *
 * Questions in one call are answered in parallel against a state that is billed
 * once, so the count barely moves latency: measured Sep 27 2026, 1 question
 * 330 ms, 250 questions 360 ms, 500 questions 2-4 s. Jevis sends every entry's
 * question at once and splits past CHUNK into parallel calls.
 *
 * Every call is recorded (~/.jevis/jev/calls.jsonl, the question set by version
 * in ~/.jevis/jev/questions/) as training data for a local model later.
 */

/**
 * Where the yes/no questions go. TypeSafe's hosted Jev by default; any server
 * that speaks the same POST /v1/systemone protocol works, such as a self-hosted
 * Laya (`laya-serve`): set JEVIS_JEV_URL to its full endpoint.
 */
export const TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone";
export const jevUrl = () => process.env.JEVIS_JEV_URL?.trim() || TYPESAFE_URL;
export const jevModel = () => process.env.JEVIS_JEV_MODEL?.trim() || (jevUrl() === TYPESAFE_URL ? "jev-latest" : undefined);
export const CHUNK = 200;
/** Questions per request. Jev takes hundreds; laya-serve refuses more than 64. JEVIS_JEV_CHUNK overrides. */
export const chunkSize = () => Number(process.env.JEVIS_JEV_CHUNK) || (jevUrl() === TYPESAFE_URL ? CHUNK : 64);

/** JEVIS_JEV_KEY, else TYPESAFE_API_KEY, else ~/.jevis/secrets/typesafe_api_key. */
function apiKey() {
  const env = process.env.JEVIS_JEV_KEY ?? process.env.TYPESAFE_API_KEY;
  if (env?.trim()) return env.trim();
  const file = join(jevisHome(), "secrets", "typesafe_api_key");
  return existsSync(file) ? readFileSync(file, "utf8").trim() : null;
}

/** TypeSafe needs a key. A self-hosted server may run without one (Laya does unless LAYA_API_KEY is set). */
const needsKey = () => jevUrl() === TYPESAFE_URL;

async function httpTransport(body, timeoutMs, signal) {
  const key = apiKey();
  if (!key && needsKey()) throw new Error("no TypeSafe API key");
  const res = await fetch(jevUrl(), {
    method: "POST",
    headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${String(json?.error?.message ?? json?.detail ?? json?.error ?? "").slice(0, 200)}`);
  return json;
}

/**
 * Jev's latency has a long tail. Sep 27 2026, 20 sequential calls: median 390 ms,
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

export const jevAvailable = () => process.env.JEVIS_JEV !== "off" && (transport !== null || !needsKey() || apiKey() !== null);

/** A question set's version: recorded answers are only comparable within one version. */
export const questionsVersion = (questions) => createHash("sha256").update(JSON.stringify(Object.keys(questions).sort().map((k) => [k, questions[k]]))).digest("hex").slice(0, 12);

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
 * Ask Jev every question about one state. Returns { answers, ms, error }:
 * answers is null when Jev is off, unconfigured, slow, or failing, and the
 * caller then does nothing (Jevis fails open).
 */
export async function askJev({ state, questions, event, sessionId = null, harness = null, model = null, timeoutMs = 3000, record: keep = true }) {
  if (!Object.keys(questions).length) return { answers: {}, ms: 0, error: null };
  if (!jevAvailable()) return { answers: null, ms: 0, error: "jev unavailable" };
  const started = Date.now();
  const clean = redactDeep(state);
  let answers = null;
  let error = null;
  let usage = { input_tokens: 0, output_tokens: 0 };
  try {
    const responses = await Promise.all(chunks(questions).map((qs) => hedged(transport ?? httpTransport, { state: clean, ...(jevModel() ? { model: jevModel() } : {}), questions: qs }, timeoutMs, transport || !needsKey() ? [] : HEDGES)));
    answers = {};
    for (const r of responses) {
      if (!r?.answers) throw new Error(String(r?.error?.message ?? r?.error ?? "no answers").slice(0, 200));
      Object.assign(answers, r.answers);
      usage.input_tokens += r.usage?.input_tokens ?? 0;
      usage.output_tokens += r.usage?.output_tokens ?? 0;
    }
  } catch (e) {
    answers = null;
    error = e?.name === "TimeoutError" ? `timeout after ${timeoutMs} ms` : String(e?.message ?? e).split("\n")[0].slice(0, 200);
  }
  const ms = Date.now() - started;
  const version = questionsVersion(questions);
  if (keep) record({ at: new Date(started).toISOString(), event, version, sessionId, harness, model, ms, state: clean, answers, usage, error }, questions);
  return { answers, ms, error };
}
