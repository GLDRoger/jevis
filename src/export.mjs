import { createHash } from "node:crypto";
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { redactDeep } from "./redact.mjs";
import { jevisHome } from "./state.mjs";
import { eachJsonl } from "./transcript.mjs";

/**
 * `jevis export`: the Jev call record as a Laya training set, in the row
 * format of the typed-decisions dataset Laya's notebook trains on:
 *
 *   { id, workflow, state, questions, gold }   state, questions, gold as JSON strings
 *
 * Each recorded call is one row: the masked state Jev saw, the questions it
 * answered (from questions/<version>.json), and its answers as the gold,
 * `{ label, probabilities: { true, false }, noul }` for a yes/no. Fine-tuning
 * Laya on it distills Jev on this user's own work, for a local model with no
 * per-call cost or network hop.
 *
 * Rows are split into train and test by session, so no session is in both,
 * and a call whose state and question set repeat an earlier one is dropped.
 * The files are gzipped JSON lines, which `load_dataset("json")` reads as
 * they are: every row repeats its questions' wording, and 15k calls made
 * 603 MB of rows, 133 MB gzipped (Sep 29 2026).
 */

export const TEST_SHARE = 0.1;

const hash = (text) => createHash("sha256").update(text).digest("hex");

/** Jev's answer as a gold label: yes/no only; any other kind is left out. */
export function goldOf(answer) {
  const p = typeof answer === "number" ? answer : typeof answer?.noul === "number" ? answer.noul : null;
  if (p === null || p < 0 || p > 1) return null;
  const q = Math.round(p * 1000) / 1000;
  return { label: q >= 0.5 ? "true" : "false", probabilities: { true: q, false: Math.round((1 - q) * 1000) / 1000 }, noul: q };
}

/**
 * The sessions held out for testing: a session's calls resemble each other,
 * so splitting inside one would leak. Sessions are taken in a fixed
 * pseudo-random order until they hold `share` of the rows, passing over any
 * too big to fit; one long session can be most of the record.
 */
export function pickTest(counts, share = TEST_SHARE) {
  const target = [...counts.values()].reduce((a, b) => a + b, 0) * share;
  const test = new Set();
  let n = 0;
  for (const key of [...counts.keys()].sort((a, b) => (hash(a) < hash(b) ? -1 : 1))) {
    if (n >= target) break;
    const c = counts.get(key);
    if (n + c <= target * 1.5) {
      test.add(key);
      n += c;
    }
  }
  return test;
}

/** A gzip file written in 8 MB members: valid gzip that stays small in memory, however long the record. */
function gzipWriter(file) {
  const fd = openSync(file, "w", 0o600);
  chmodSync(file, 0o600);
  let parts = [];
  let size = 0;
  let wrote = false;
  const flush = () => {
    if (!parts.length && wrote) return;
    writeSync(fd, gzipSync(parts.join("")));
    wrote = true;
    parts = [];
    size = 0;
  };
  return {
    write(line) {
      parts.push(line);
      size += line.length;
      if (size > 8 * 1024 * 1024) flush();
    },
    close() {
      flush();
      closeSync(fd);
    },
  };
}

export function exportDataset({ out, home = jevisHome(), events = ["prompt", "tool", "stop"], since = 0, testShare = TEST_SHARE } = {}) {
  const calls = join(home, "jev", "calls.jsonl");
  if (!existsSync(calls)) throw new Error(`no call record at ${calls}: Jevis records calls unless JEVIS_RECORD=off`);
  const keep = (line) => events.some((ev) => line.includes(`"event":"${ev}"`));
  const usable = (r) => events.includes(r.event) && !(since && Date.parse(r.at) < since) && !r.error && r.answers;
  const sessionOf = (r) => r.sessionId ?? "no session";
  const counts = new Map();
  eachJsonl(calls, (r) => usable(r) && counts.set(sessionOf(r), (counts.get(sessionOf(r)) ?? 0) + 1), { keep });
  const test = pickTest(counts, testShare);
  mkdirSync(out, { recursive: true, mode: 0o700 });
  const files = { train: join(out, "train.jsonl.gz"), test: join(out, "test.jsonl.gz") };
  // Prompts and file names are masked for secrets, not anonymized: the files are private like the record they come from.
  const writers = Object.fromEntries(Object.entries(files).map(([k, f]) => [k, gzipWriter(f)]));
  const sets = new Map();
  const questionSet = (version) => {
    if (!sets.has(version)) {
      const f = join(home, "jev", "questions", `${version}.json`);
      try {
        sets.set(version, JSON.parse(readFileSync(f, "utf8")));
      } catch {
        sets.set(version, null);
      }
    }
    return sets.get(version);
  };
  const seen = new Set();
  const n = { train: 0, test: 0, questions: 0, errors: 0, duplicates: 0, unanswerable: 0, sessions: new Set() };
  try {
    eachJsonl(calls, (r) => {
      if (!events.includes(r.event) || (since && Date.parse(r.at) < since)) return;
      if (r.error || !r.answers) return void (n.errors += 1);
      const qs = questionSet(r.version);
      if (!qs) return void (n.unanswerable += 1);
      // Masked again: a record written before a masking rule was added can hold what today's rules catch.
      const state = JSON.stringify(redactDeep(r.state));
      const key = hash(`${r.version}\0${state}`);
      if (seen.has(key)) return void (n.duplicates += 1);
      seen.add(key);
      const gold = {};
      const questions = {};
      for (const [id, answer] of Object.entries(r.answers)) {
        const g = qs[id]?.type === "noul" ? goldOf(answer) : null;
        if (!g) continue;
        gold[id] = g;
        questions[id] = qs[id];
      }
      if (!Object.keys(gold).length) return void (n.unanswerable += 1);
      const split = test.has(sessionOf(r)) ? "test" : "train";
      const row = { id: `jevis-${key.slice(0, 16)}`, workflow: `jevis/${r.event}`, state, questions: JSON.stringify(questions), gold: JSON.stringify(gold) };
      writers[split].write(`${JSON.stringify(row)}\n`);
      n[split] += 1;
      n.questions += Object.keys(gold).length;
      if (r.sessionId) n.sessions.add(r.sessionId);
    }, { keep });
  } finally {
    for (const w of Object.values(writers)) w.close();
  }
  return { files, train: n.train, test: n.test, questions: n.questions, sessions: n.sessions.size, errors: n.errors, duplicates: n.duplicates, unanswerable: n.unanswerable };
}

export function formatExport(r) {
  return [
    `${r.train} train and ${r.test} test rows (${r.questions} answers, ${r.sessions} sessions) in`,
    `  ${r.files.train}`,
    `  ${r.files.test}`,
    `Left out: ${r.errors} failed calls, ${r.duplicates} repeats, ${r.unanswerable} with no yes/no answers or a missing question set.`,
    "",
    "The rows hold your prompts, commands, and file names. Secrets that Jevis's masking recognizes are masked (again, with today's rules); anything it does not recognize, and everything else, is as you wrote it. Upload them only as a private dataset.",
    "",
    "To fine-tune Laya on them, change the notebook's two load_dataset calls to read these files (on Kaggle, from your private dataset's path):",
    `  ds_train = load_dataset("json", data_files={"train": "train.jsonl.gz"}, split="train")`,
    `  ds_test = load_dataset("json", data_files={"test": "test.jsonl.gz"}, split="test")`,
    "Mixing them with typed-decisions (datasets.concatenate_datasets) keeps what Laya already knows.",
  ].join("\n");
}
