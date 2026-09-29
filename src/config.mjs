import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, join, posix, win32 } from "node:path";
import { ensureDir, jevisHome } from "./state.mjs";
import { isQualifiedPath, splitFolders } from "./paths.mjs";

/**
 * Settings: every setting in the README's Configuration table can live in
 * ~/.jevis/config.json, keyed by its environment variable name:
 *
 *   { "JEVIS_MODE": "shadow", "JEVIS_CRITIC": "codex", "JEVIS_ENABLE": ["safety"] }
 *
 * Hook commands then carry no NAME=value prefix, which cmd and PowerShell
 * cannot run, and an install keeps what an earlier one saved. The
 * environment still wins, so JEVIS_DISABLE=1 turns Jevis off for one session.
 *
 * Not here: JEVIS_HOME (this file lives in it) and the API key (it belongs
 * in ~/.jevis/secrets, mode 600, where no settings dump prints it).
 */

const text = (v) => typeof v === "string" && v.trim() !== "";
const oneOf = (...values) => (v) => values.includes(v);
const number = (v) => (typeof v === "number" && v > 0) || (typeof v === "string" && Number(v) > 0);
const list = (v) => text(v) || (Array.isArray(v) && v.length > 0 && v.every(text));
export const absolutePaths = (v, platform = process.platform) => list(v) && [v].flat().flatMap((x) => splitFolders(x, platform === "win32" ? win32.delimiter : posix.delimiter)).every((x) => isQualifiedPath(x, platform));
const httpUrl = (v) => typeof v === "string" && /^https?:\/\/[^\s'"`$;&|<>]+$/.test(v);

/** Each setting: how to check a value, how to write it as the environment reads it, and what it does. */
export const SETTINGS = {
  JEVIS_MODE: { ok: oneOf("live", "shadow"), help: "live, or shadow: log what Jevis would do and change nothing" },
  JEVIS_DISABLE: { ok: oneOf(true, false, "1", "0"), env: (v) => (v === true || v === "1" ? "1" : null), help: "true turns every hook off" },
  JEVIS_SCOPE: { ok: list, env: (v) => [v].flat().join(delimiter), help: `folders Jevis acts in (a list, or ${process.platform === "win32" ? "semicolon" : "colon"}-separated)` },
  JEVIS_ENABLE: { ok: list, env: (v) => [v].flat().join(","), help: "optional entries to turn on: safety, all, or entry ids" },
  JEVIS_CRITIC: { ok: oneOf("claude", "codex", "off"), help: "who reviews visual work: claude, codex, or off" },
  JEVIS_CRITIC_MODEL: { ok: text, help: "the model the critic uses" },
  JEVIS_DESIGN_LAW: { ok: text, help: "a Markdown file of your own design rules" },
  JEVIS_WIKI: { ok: absolutePaths, env: (v) => [v].flat().join(delimiter), help: "absolute lesson folders, replacing the defaults" },
  JEVIS_JEV_URL: { ok: httpUrl, help: "a /v1/systemone server instead of TypeSafe" },
  JEVIS_JEV_MODEL: { ok: text, help: "the model field sent with each call" },
  JEVIS_JEV_CHUNK: { ok: number, env: String, help: "questions per request" },
  JEVIS_TIMEOUT_MS: { ok: number, env: String, help: "how long a hook waits for the decision model" },
  JEVIS_RECORD: { ok: oneOf("on", "off", true, false), env: (v) => (v === false || v === "off" ? "off" : "on"), help: "off keeps no record of Jev calls" },
};

const REFUSED = {
  JEVIS_HOME: "JEVIS_HOME cannot be set here: this file lives in it",
  JEVIS_JEV_KEY: "the API key belongs in ~/.jevis/secrets/typesafe_api_key (mode 600), not in the settings file",
  TYPESAFE_API_KEY: "the API key belongs in ~/.jevis/secrets/typesafe_api_key (mode 600), not in the settings file",
};

export const configFile = () => join(jevisHome(), "config.json");

/** The settings file as written, its valid settings, and a message for each problem. A missing file is empty, not an error. */
export function readConfig(file = configFile()) {
  if (!existsSync(file)) return { file, exists: false, raw: {}, values: {}, errors: [] };
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    return { file, exists: true, raw: null, values: {}, errors: [`not valid JSON: ${String(e.message).slice(0, 120)}`] };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { file, exists: true, raw: null, values: {}, errors: ["must be a JSON object of settings"] };
  const values = {};
  const errors = [];
  for (const [key, value] of Object.entries(raw)) {
    const s = SETTINGS[key];
    if (REFUSED[key]) errors.push(REFUSED[key]);
    else if (!s) errors.push(`${key} is not a setting (known: ${Object.keys(SETTINGS).join(", ")})`);
    else if (!s.ok(value)) errors.push(`${key}: ${JSON.stringify(value)} is not valid (${s.help})`);
    else {
      const env = (s.env ?? String)(value);
      if (env !== null) values[key] = env;
    }
  }
  return { file, exists: true, raw, values, errors };
}

/**
 * Put the file's valid settings into `env` where the environment has none.
 * Called once when the CLI starts, so every hook and command reads one
 * place. Never throws: a broken file is ignored here and reported by
 * `jevis doctor`.
 */
const fromFile = new Set();
export function applyConfig(env = process.env) {
  try {
    const config = readConfig();
    for (const [key, value] of Object.entries(config.values)) {
      if (env[key] !== undefined) continue;
      env[key] = value;
      fromFile.add(key);
    }
    return config;
  } catch {
    return null;
  }
}

/** Each setting's effective value and where it came from: the environment, the settings file, or the default. */
export const settingSources = (env = process.env) =>
  Object.keys(SETTINGS).map((key) => ({ key, value: env[key] ?? null, source: env[key] === undefined ? "default" : fromFile.has(key) ? "file" : "environment" }));

/** Write settings: keys set to null or undefined are removed. The file is private (0600) like everything in ~/.jevis. */
export function writeConfig(changes, file = configFile()) {
  const current = readConfig(file);
  if (current.raw === null) throw new Error(`${file} is ${current.errors[0]}; fix or remove it first`);
  const next = { ...current.raw };
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === undefined) delete next[key];
    else next[key] = value;
  }
  ensureDir();
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  // The mode above applies only to a new file; one the user created by hand is made private too.
  if (process.platform !== "win32") chmodSync(file, 0o600);
  return next;
}
