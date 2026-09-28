#!/usr/bin/env node
/**
 * Installs Jevis's hooks into Claude Code and Codex.
 *
 *   node bin/install.mjs                     # both harnesses, live
 *   node bin/install.mjs --shadow            # log what Jevis would do, change nothing in sessions
 *   node bin/install.mjs --harness claude    # one harness
 *   node bin/install.mjs --dry-run           # print the new config, write nothing
 *   node bin/install.mjs --jev-url http://127.0.0.1:8000/v1/systemone   # a self-hosted Laya instead of TypeSafe
 *   node bin/install.mjs --uninstall         # remove Jevis's hooks
 *
 * Every write is preceded by a backup in ~/.jevis/backups/<time>/. Hooks that
 * are not Jevis's are left exactly as they are. Running it twice gives the
 * same config.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const JEVIS = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(JEVIS, "bin", "jevis.mjs");

export const TARGETS = {
  claude: join(homedir(), ".claude", "settings.json"),
  codex: join(homedir(), ".codex", "hooks.json"),
};

const isJevis = (cmd) => /bin\/jevis\.mjs hook /.test(cmd ?? "");

/** The node binary an earlier Jevis install runs with: a path known to work in this user's hooks. */
export function nodeIn(config) {
  for (const groups of Object.values(config?.hooks ?? {})) for (const g of groups ?? []) for (const h of g.hooks ?? []) {
    const m = isJevis(h.command) && String(h.command).match(/(?:^|\s)(\/\S*\/node)\s/);
    if (m && existsSync(m[1])) return m[1];
  }
  return null;
}

/** Jevis's entries for one harness. Claude Code filters tools by matcher; Codex sends every tool. */
export function jevisHooks(harness, { node = process.execPath, cli = CLI, shadow = false, jevUrl = null } = {}) {
  if (jevUrl && !/^https?:\/\/[^\s'"`$;&|<>]+$/.test(jevUrl)) throw new Error(`--jev-url must be a plain http(s) URL, got ${jevUrl}`);
  const env = [shadow ? "JEVIS_MODE=shadow" : "", jevUrl ? `JEVIS_JEV_URL=${jevUrl}` : ""].filter(Boolean).map((v) => `${v} `).join("");
  const hook = (event, timeout, matcher) => [{ ...(matcher ? { matcher } : {}), hooks: [{ type: "command", command: `${env}${node} ${cli} hook ${event}`, timeout }] }];
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
  const opts = { uninstall: has("uninstall"), shadow: has("shadow"), jevUrl: value("jev-url") };
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backups = join(homedir(), ".jevis", "backups", stamp);
  if (!opts.uninstall && !opts.jevUrl && !existsSync(join(homedir(), ".jevis", "secrets", "typesafe_api_key")) && !process.env.TYPESAFE_API_KEY && !process.env.JEVIS_JEV_KEY) {
    console.log("No TypeSafe key in ~/.jevis/secrets/typesafe_api_key: Jevis will install but do nothing until one is there (mode 600), or reinstall with --jev-url for a Laya server.");
  }
  for (const harness of pick) {
    const file = TARGETS[harness];
    if (!file) throw new Error(`unknown harness ${harness}`);
    const before = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
    const { config, removed } = plan(before, harness, { ...opts, node: nodeIn(before) ?? process.execPath });
    console.log(`\n${harness}: ${file}`);
    for (const r of removed) console.log(`  - ${r}`);
    for (const [event, groups] of Object.entries(config.hooks ?? {})) for (const g of groups) for (const h of g.hooks) if (isJevis(h.command)) console.log(`  + ${event}: ${h.command}`);
    if (has("dry-run")) continue;
    if (existsSync(file)) {
      mkdirSync(backups, { recursive: true });
      copyFileSync(file, join(backups, `${harness}-${file.split("/").pop()}`));
    }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  }
  if (has("dry-run")) return console.log("\nDry run: nothing written.");
  console.log(`\nBackups: ${backups}`);
  if (!opts.uninstall) {
    console.log("Takes effect in new sessions. Codex asks you to review new hooks once before it runs them.");
    console.log(opts.shadow ? "Shadow mode: Jevis logs what it would do (jevis stats) and changes nothing." : "Live. JEVIS_DISABLE=1 turns it off for one session; --uninstall removes it.");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
