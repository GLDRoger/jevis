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
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SETTINGS, configFile, readConfig, writeConfig } from "../src/config.mjs";
import { ensureDir, jevisHome } from "../src/state.mjs";

const JEVIS = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(JEVIS, "bin", "jevis.mjs");

export const TARGETS = {
  claude: join(homedir(), ".claude", "settings.json"),
  codex: join(homedir(), ".codex", "hooks.json"),
};

const isJevis = (cmd) => /bin[\\/]jevis\.mjs"? hook /.test(cmd ?? "");
/** A path as a hook command word: quoted when it has a space (C:\Program Files\nodejs\node.exe). */
const word = (path) => (/\s/.test(path) ? `"${path}"` : path);

export const CRITICS = ["claude", "codex", "off"];

const CHROME = {
  darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
  linux: ["/opt/google/chrome/chrome", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"],
  win32: [join(process.env.PROGRAMFILES ?? "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe")],
};

/** Whether a command is on PATH, found without running anything. */
export const onPath = (cmd, path = process.env.PATH ?? "") => path.split(delimiter).some((d) => d && (existsSync(join(d, cmd)) || existsSync(join(d, `${cmd}.exe`))));

/** One line on whether the design and film review can run with this critic, and what to do if not. */
export function reviewStatus(critic, { chrome = (CHROME[process.platform] ?? []).some(existsSync), cli = onPath(critic) } = {}) {
  if (critic === "off") return "Design review: off. Every other check still runs.";
  const missing = [chrome ? "" : "Google Chrome", cli ? "" : `the ${critic} CLI`].filter(Boolean);
  if (!missing.length) return `Design review: on, reviewed by ${critic === "codex" ? "Codex" : "Claude"} through your own ${critic} CLI and plan.`;
  return `Design review: skipped until ${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} installed. Every other check still runs. To turn it off explicitly, reinstall with --critic off${critic === "claude" ? ", or pick --critic codex" : ""}.`;
}

/** The node binary an earlier Jevis install runs with: a path known to work in this user's hooks. */
export function nodeIn(config) {
  for (const groups of Object.values(config?.hooks ?? {})) for (const g of groups ?? []) for (const h of g.hooks ?? []) {
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
export function carriedSettings(config) {
  const out = {};
  for (const groups of Object.values(config?.hooks ?? {})) for (const g of groups ?? []) for (const h of g.hooks ?? []) {
    if (!isJevis(h.command)) continue;
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

/** Jevis's entries for one harness: plain commands with no settings on them. Claude Code filters tools by matcher; Codex sends every tool. */
export function jevisHooks(harness, { node = process.execPath, cli = CLI } = {}) {
  const hook = (event, timeout, matcher) => [{ ...(matcher ? { matcher } : {}), hooks: [{ type: "command", command: `${word(node)} ${word(cli)} hook ${event}`, timeout }] }];
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
        const drop = isJevis(h.command);
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
  const carried = Object.assign({}, ...Object.values(befores).map(carriedSettings));
  const changes = opts.uninstall ? {} : settingsChanges(opts, { carried, saved: saved.raw });
  const settings = { ...saved.raw };
  for (const [k, v] of Object.entries(changes)) v === null ? delete settings[k] : (settings[k] = v);
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
    const before = befores[harness];
    const { config, removed } = plan(before, harness, { uninstall: opts.uninstall, node: nodeIn(before) ?? process.execPath });
    console.log(`\n${harness}: ${file}`);
    for (const r of removed) console.log(`  - ${r}`);
    for (const [event, groups] of Object.entries(config.hooks ?? {})) for (const g of groups) for (const h of g.hooks) if (isJevis(h.command)) console.log(`  + ${event}: ${h.command}`);
    if (dry) continue;
    if (existsSync(file)) {
      // A settings file can hold API keys in its env block: the copy is private whatever the original's mode.
      const copy = join(ensureDir("backups", stamp), `${harness}-${basename(file)}`);
      copyFileSync(file, copy);
      chmodSync(copy, 0o600);
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
