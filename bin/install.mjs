#!/usr/bin/env node
/**
 * Installs Jevis's hooks into Claude Code and Codex.
 *
 *   node bin/install.mjs                     # both harnesses
 *   node bin/install.mjs --shadow            # log what Jevis would do, change nothing in sessions (--live to go back)
 *   node bin/install.mjs --harness claude    # one harness
 *   node bin/install.mjs --dry-run           # print the new config, write nothing
 *   node bin/install.mjs --jev-url http://127.0.0.1:8000/v1/systemone   # a self-hosted Laya instead of TypeSafe (typesafe to go back)
 *   node bin/install.mjs --critic codex      # who reviews visual work: claude (default), codex, or off
 *   node bin/install.mjs --uninstall         # remove Jevis's hooks
 *
 * Every write is preceded by a backup in ~/.jevis/backups/<time>/. Hooks that
 * are not Jevis's are left exactly as they are. Running it twice gives the
 * same config. Options are saved in ~/.jevis/config.json, not on the hook
 * commands: they last until changed, and the commands run in any shell.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SETTINGS, configFile, readConfig, writeConfig } from "../src/config.mjs";
import { ensureDir, jevisHome } from "../src/state.mjs";
import { isQualifiedPath } from "../src/paths.mjs";

const JEVIS = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(JEVIS, "bin", "jevis.mjs");

export const TARGETS = {
  claude: join(homedir(), ".claude", "settings.json"),
  codex: join(homedir(), ".codex", "hooks.json"),
};

export const isJevis = (cmd, platform = process.platform) => new RegExp('bin[\\\\/]jevis\\.mjs"? hook ', platform === "win32" ? "i" : "").test(cmd ?? "");
/** A hook command's words, preserving backslashes in older Windows installs. */
export const commandWords = (cmd) => [...String(cmd).matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
/** Only literal shell words are supported; one escaping scheme cannot serve bash, PowerShell, and cmd. */
export function word(path, platform = process.platform) {
  const forbidden = [...path].filter((ch) => /[%$`"!\p{Cc}]/u.test(ch) || (platform !== "win32" && ch === "\\"));
  if (forbidden.length) {
    const chars = [...new Set(forbidden)].map((ch) => `${JSON.stringify(ch)} (U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")})`);
    throw new Error(`Cannot install hook path ${JSON.stringify(path)}: unsupported characters ${chars.join(", ")}`);
  }
  const value = platform === "win32" ? path.replaceAll("\\", "/") : path;
  return /^[\p{L}\p{Nd}._\-/:+@,~=]+$/u.test(value) ? value : `"${value}"`;
}

/** A short executable name avoids cmd's search of the current folder for a bare node command. */
export function windowsShortPath(path, { platform = process.platform, exec = execFileSync, exists = existsSync, comspec = process.env.ComSpec ?? process.env.COMSPEC ?? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe") } = {}) {
  word(path, "win32");
  if (platform !== "win32") return null;
  try {
    // Without 8.3 names the result can still contain metacharacters, so echo it inside quotes too.
    const output = exec(comspec, ["/d", "/s", "/v:off", "/c", `"for %I in ("${path}") do @echo "%~sI""`], { encoding: "utf8", timeout: 1000, windowsVerbatimArguments: true, windowsHide: true }).trim();
    const result = output.replace(/^"([^"\r\n]*)"$/, "$1");
    const value = word(result, "win32");
    return isQualifiedPath(value, "win32") && !value.startsWith('"') && exists(result) ? value : null;
  } catch {
    return null;
  }
}

export const CRITICS = ["claude", "codex", "off"];

const CHROME = {
  darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
  linux: ["/opt/google/chrome/chrome", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"],
  win32: [join(process.env.PROGRAMFILES ?? "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe")],
};

/** Whether a command is on PATH, found without running anything. */
export function findOnPath(cmd, path = process.env.PATH ?? "", platform = process.platform) {
  if (!cmd) return null;
  const suffixes = platform === "win32" ? (/\.(exe|cmd|bat)$/i.test(cmd) ? [""] : [".exe", ".cmd", ".bat"]) : ["", ".exe"];
  for (const d of path.split(platform === "win32" ? ";" : delimiter).filter(Boolean)) {
    for (const suffix of suffixes) {
      const file = join(platform === "win32" ? d.replace(/^"|"$/g, "") : d, `${cmd}${suffix}`);
      if (existsSync(file)) return file;
    }
  }
  return null;
}
export const onPath = (cmd, path = process.env.PATH ?? "", platform = process.platform) => findOnPath(cmd, path, platform) !== null;

/** One line on whether the design and film review can run with this critic, and what to do if not. */
export function reviewStatus(critic, { chrome = (CHROME[process.platform] ?? []).some(existsSync), cli = onPath(critic) } = {}) {
  if (critic === "off") return "Design review: off. Every other check still runs.";
  const missing = [chrome ? "" : "Google Chrome", cli ? "" : `the ${critic} CLI`].filter(Boolean);
  if (!missing.length) return `Design review: on, reviewed by ${critic === "codex" ? "Codex" : "Claude"} through your own ${critic} CLI and plan.`;
  return `Design review: skipped until ${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} installed. Every other check still runs. To turn it off explicitly, reinstall with --critic off${critic === "claude" ? ", or pick --critic codex" : ""}.`;
}

/** The node binary an earlier Jevis install runs with: a path known to work in this user's hooks. */
export function nodeIn(config, { platform = process.platform, exists = existsSync, onPath: found = onPath } = {}) {
  for (const groups of Object.values(config?.hooks ?? {})) for (const g of groups ?? []) for (const h of g.hooks ?? []) {
    if (platform === "win32") {
      if (!isJevis(h.command, platform)) continue;
      const node = commandWords(h.command).find((w) => /(?:^|[\\/])node(?:\.exe)?$/i.test(w));
      if (node && (/[\\/]/.test(node) ? exists(node) : found(node))) return node;
      continue;
    }
    const m = isJevis(h.command) && String(h.command).match(/(?:^|\s)"?(\/[^"]*?\/node)"?\s/);
    if (m && existsSync(m[1])) return m[1];
  }
  return null;
}

/**
 * Settings an earlier install put on its hook commands (JEVIS_MODE=shadow
 * node .../jevis.mjs hook stop). They move to config.json, so reinstalling
 * does not quietly drop them.
 */
export function carriedSettings(config, { platform = process.platform } = {}) {
  const out = {};
  for (const groups of Object.values(config?.hooks ?? {})) for (const g of groups ?? []) for (const h of g.hooks ?? []) {
    if (!isJevis(h.command, platform)) continue;
    for (const [, key, value] of String(h.command).matchAll(/(?:^|\s)(JEVIS_[A-Z_]+)=(\S+)(?=\s)/g)) if (SETTINGS[key] && SETTINGS[key].ok(value)) out[key] = value;
  }
  return out;
}

/**
 * What an install changes in config.json: the options passed, and settings
 * carried from older hook commands where the file has none yet. A value of
 * null removes a setting, so its default applies.
 */
export function settingsChanges({ shadow = false, live = false, jevUrl = null, critic = null } = {}, { carried = {}, saved = {} } = {}) {
  if (shadow && live) throw new Error("--shadow and --live contradict each other");
  if (jevUrl && !["typesafe", "default"].includes(jevUrl) && !SETTINGS.JEVIS_JEV_URL.ok(jevUrl)) throw new Error(`--jev-url must be a plain http(s) URL, or typesafe for the default, got ${jevUrl}`);
  if (critic && !CRITICS.includes(critic)) throw new Error(`--critic must be one of ${CRITICS.join(", ")}, got ${critic}`);
  const changes = {};
  for (const [key, value] of Object.entries(carried)) if (saved[key] === undefined) changes[key] = value;
  if (shadow) changes.JEVIS_MODE = "shadow";
  if (live) changes.JEVIS_MODE = null;
  if (jevUrl) changes.JEVIS_JEV_URL = ["typesafe", "default"].includes(jevUrl) ? null : jevUrl;
  // claude is the default, so choosing it removes the setting.
  if (critic) changes.JEVIS_CRITIC = critic === "claude" ? null : critic;
  return changes;
}

/** Windows needs an unquoted executable word in every supported shell; forward slashes survive Git Bash. */
export function hookCommand(event, { platform = process.platform, execPath = process.execPath, cli = CLI, shortPath = windowsShortPath } = {}) {
  const script = word(cli, platform);
  let node = word(execPath, platform);
  if (platform === "win32" && node.startsWith('"')) {
    const short = shortPath(execPath);
    const candidate = short ? word(short, platform) : null;
    node = candidate && isQualifiedPath(candidate, platform) && !candidate.startsWith('"') ? candidate : "node";
  }
  return `${node} ${script} hook ${event}`;
}

/** Jevis's entries for one harness: plain commands with no settings on them. Claude Code filters tools by matcher; Codex sends every tool. */
export function jevisHooks(harness, { node = process.execPath, execPath = node, cli = CLI, platform = process.platform, shortPath = windowsShortPath } = {}) {
  const prefix = hookCommand("", { platform, execPath, cli, shortPath });
  const hook = (event, timeout, matcher) => [{ ...(matcher ? { matcher } : {}), hooks: [{ type: "command", command: `${prefix}${event}`, timeout }] }];
  const out = {
    UserPromptSubmit: hook("prompt", 10),
    PreToolUse: hook("tool", 10, harness === "claude" ? "^(Bash|Edit|Write|MultiEdit|NotebookEdit|mcp__.*)$" : undefined),
    // The design review renders the page and waits on a critic: about 30-90 s a round.
    Stop: hook("stop", 420),
    SessionStart: hook("session", 10),
  };
  if (harness === "codex") out.PostCompact = hook("session", 10);
  return out;
}

/** The config with any earlier Jevis entries removed and, unless uninstalling, Jevis's added. */
export function plan(config, harness, { uninstall = false, ...opts } = {}) {
  const next = structuredClone(config ?? {});
  const hooks = next.hooks ?? {};
  const removed = [];
  for (const [event, groups] of Object.entries(hooks)) {
    const kept = [];
    for (const group of groups ?? []) {
      const inner = (group.hooks ?? []).filter((h) => {
        const drop = isJevis(h.command, opts.platform);
        if (drop) removed.push(`${event}: ${h.command}`);
        return !drop;
      });
      if (inner.length) kept.push({ ...group, hooks: inner });
    }
    if (kept.length) hooks[event] = kept;
    else delete hooks[event];
  }
  if (!uninstall) for (const [event, groups] of Object.entries(jevisHooks(harness, opts))) hooks[event] = [...(hooks[event] ?? []), ...groups];
  if (Object.keys(hooks).length) next.hooks = hooks;
  else delete next.hooks;
  return { config: next, removed };
}

function main(argv) {
  const has = (f) => argv.includes(`--${f}`);
  const pick = argv.includes("--harness") ? argv[argv.indexOf("--harness") + 1].split(",") : Object.keys(TARGETS);
  const value = (f) => (argv.includes(`--${f}`) ? argv[argv.indexOf(`--${f}`) + 1] : null);
  const opts = { uninstall: has("uninstall"), shadow: has("shadow"), live: has("live"), jevUrl: value("jev-url"), critic: value("critic") };
  const dry = has("dry-run");
  // Only the words the hook commands contain must survive every shell; other paths are opened by Node, not a shell.
  for (const path of [CLI, process.execPath]) word(path);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backups = join(jevisHome(), "backups", stamp);
  const befores = Object.fromEntries(pick.map((harness) => {
    const file = TARGETS[harness];
    if (!file) throw new Error(`unknown harness ${harness}`);
    return [harness, existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {}];
  }));
  // Settings first: a bad option or a broken config.json stops the install before any harness file changes.
  const saved = readConfig();
  if (saved.raw === null) throw new Error(`${saved.file} is ${saved.errors[0]}; fix or remove it first`);
  const carried = Object.assign({}, ...Object.values(befores).map((config) => carriedSettings(config)));
  const changes = opts.uninstall ? {} : settingsChanges(opts, { carried, saved: saved.raw });
  const settings = { ...saved.raw };
  for (const [k, v] of Object.entries(changes)) v === null ? delete settings[k] : (settings[k] = v);
  const plans = Object.fromEntries(pick.map((harness) => [harness, plan(befores[harness], harness, {
    uninstall: opts.uninstall,
    node: process.platform === "win32" ? process.execPath : nodeIn(befores[harness]) ?? process.execPath,
  })]));
  const usesTypeSafe = !process.env.JEVIS_JEV_URL && !settings.JEVIS_JEV_URL;
  if (!opts.uninstall && usesTypeSafe && !existsSync(join(jevisHome(), "secrets", "typesafe_api_key")) && !process.env.TYPESAFE_API_KEY && !process.env.JEVIS_JEV_KEY) {
    console.log("No TypeSafe key in ~/.jevis/secrets/typesafe_api_key: Jevis will install but do nothing until one is there (mode 600), or reinstall with --jev-url for a Laya server.");
  }
  if (Object.keys(changes).length) {
    console.log(`\nsettings: ${configFile()}`);
    for (const [k, v] of Object.entries(changes)) console.log(v === null ? `  - ${k} (back to its default)` : `  + ${k}=${JSON.stringify(v)}`);
    if (!dry) writeConfig(changes);
  }
  for (const harness of pick) {
    const file = TARGETS[harness];
    const { config, removed } = plans[harness];
    console.log(`\n${harness}: ${file}`);
    for (const r of removed) console.log(`  - ${r}`);
    for (const [event, groups] of Object.entries(config.hooks ?? {})) for (const g of groups) for (const h of g.hooks) if (isJevis(h.command)) console.log(`  + ${event}: ${h.command}`);
    if (dry) continue;
    if (existsSync(file)) {
      // A settings file can hold API keys in its env block: the copy is private whatever the original's mode.
      const copy = join(ensureDir("backups", stamp), `${harness}-${basename(file)}`);
      copyFileSync(file, copy);
      if (process.platform !== "win32") chmodSync(copy, 0o600);
    }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  }
  if (dry) return console.log("\nDry run: nothing written.");
  console.log(`\nBackups: ${backups}`);
  if (opts.uninstall) return console.log(`Your settings stay in ${configFile()} for a later install.`);
  console.log("Takes effect in new sessions. Codex asks you to review new hooks once before it runs them.");
  console.log(settings.JEVIS_MODE === "shadow" ? "Shadow mode: Jevis logs what it would do (jevis stats) and changes nothing. --live switches it on." : "Live. JEVIS_DISABLE=1 turns it off for one session; --uninstall removes it.");
  console.log(reviewStatus(settings.JEVIS_CRITIC ?? "claude"));
  console.log("node bin/jevis.mjs doctor checks the whole setup.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
