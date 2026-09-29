import { appendFileSync, chmodSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { redactDeep } from "./redact.mjs";
import { eachJsonl } from "./transcript.mjs";

/** Where Jevis keeps session memory, its decision log, and the Jev call record. Private to this user: it holds prompts. */
export const jevisHome = () => process.env.JEVIS_HOME || join(homedir(), ".jevis");

/**
 * A folder under Jevis's home, created private. An existing one is made
 * private too: `mkdir -p ~/.jevis/secrets` creates the home world-readable,
 * an older install made backups/ that way, and they hold prompts, the call
 * record, and config backups. Checked once per folder per process.
 */
export function ensureDir(...parts) {
  const root = jevisHome();
  const dir = join(root, ...parts);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform === "win32") return dir;
  for (const d of [root, ...parts.map((_, i) => join(root, ...parts.slice(0, i + 1)))]) {
    if (checked.has(d)) continue;
    try {
      if (statSync(d).mode & 0o077) chmodSync(d, 0o700);
    } catch {
      /* not ours to change; the files inside are still 0600 */
    }
    checked.add(d);
  }
  return dir;
}
const checked = new Set();

const sessionFile = (id) => join(ensureDir("sessions"), `${String(id).replace(/[^\w.-]/g, "_")}.json`);

/** What Jevis remembers about one session: the current request, the turn count, which notes it already gave. */
export function loadSession(id) {
  if (!id) return freshSession();
  try {
    return { ...freshSession(), ...JSON.parse(readFileSync(sessionFile(id), "utf8")) };
  } catch {
    return freshSession();
  }
}

export function saveSession(id, state, { platform = process.platform, rename = renameSync, wait = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) } = {}) {
  if (!id) return;
  let tmp;
  try {
    const file = sessionFile(id);
    // Parallel hooks must never read a half-written file. Windows readers can briefly hold the target open.
    tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
    for (let attempt = 0; ; attempt += 1) {
      try {
        rename(tmp, file);
        return;
      } catch (e) {
        if (platform !== "win32" || !["EPERM", "EBUSY"].includes(e.code) || attempt === 4) throw e;
        wait(25);
      }
    }
  } catch {
    // Losing session memory is safer than breaking a hook. Keep the previous complete file.
    if (tmp) try { unlinkSync(tmp); } catch { /* already gone or still held open */ }
  }
}

export const freshSession = () => ({ turn: 0, request: null, previousRequest: null, firstRequest: null, turnStartedAt: null, model: null, shown: {}, stop: { turn: -1, blocked: [], reviews: 0 } });

export function log(event) {
  try {
    appendFileSync(join(ensureDir(), "log.jsonl"), `${JSON.stringify(redactDeep({ at: new Date().toISOString(), ...event }))}\n`, { mode: 0o600 });
  } catch {
    /* logging never breaks a hook */
  }
}

/** Each row of the decision log in turn: the log grows by megabytes a day, past what one string can hold. */
export const eachLog = (fn) => eachJsonl(join(jevisHome(), "log.jsonl"), fn);

export function readLog() {
  const rows = [];
  eachLog((row) => rows.push(row));
  return rows;
}
