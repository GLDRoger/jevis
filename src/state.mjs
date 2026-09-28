import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { redactDeep } from "./redact.mjs";

/** Where Jevis keeps session memory, its decision log, and the Jev call record. Private to this user: it holds prompts. */
export const jevisHome = () => process.env.JEVIS_HOME || join(homedir(), ".jevis");

export function ensureDir(...parts) {
  const dir = join(jevisHome(), ...parts);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

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

export function saveSession(id, state) {
  if (!id) return;
  const file = sessionFile(id);
  // Parallel hooks (a subagent's tool call during a prompt) must never read a half-written file.
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
  renameSync(tmp, file);
}

export const freshSession = () => ({ turn: 0, request: null, previousRequest: null, firstRequest: null, turnStartedAt: null, model: null, shown: {}, stop: { turn: -1, blocked: [], reviews: 0 } });

export function log(event) {
  try {
    appendFileSync(join(ensureDir(), "log.jsonl"), `${JSON.stringify(redactDeep({ at: new Date().toISOString(), ...event }))}\n`, { mode: 0o600 });
  } catch {
    /* logging never breaks a hook */
  }
}

export function readLog() {
  const file = join(jevisHome(), "log.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((l) => {
    try {
      return [JSON.parse(l)];
    } catch {
      return [];
    }
  });
}
