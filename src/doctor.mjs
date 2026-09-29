import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TARGETS, jevisHooks, onPath, reviewStatus } from "../bin/install.mjs";
import { readConfig, settingSources } from "./config.mjs";
import { askJev, jevUrl, TYPESAFE_URL } from "./jev.mjs";
import { jevisHome } from "./state.mjs";
import { eachJsonl } from "./transcript.mjs";
import { redact } from "./redact.mjs";
import { projectStatus, wikiFor } from "./wiki.mjs";

/**
 * `jevis doctor`: every way Jevis can be installed but silently doing
 * nothing, checked in one pass, each with the fix. Jevis fails open by
 * design, so a missing key, a moved checkout, or a broken settings file
 * looks exactly like "no lessons applied": this is where it shows.
 *
 * Each check is { name, status: ok | warn | fail | info | skip, detail, fix? }.
 */

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "jevis.mjs");
const HARNESS = { claude: "Claude Code", codex: "Codex" };
const DAY = 24 * 60 * 60 * 1000;
/** The log's last 32 MB covers well over a day of hooks; older rows are not needed for a health check. */
const LOG_TAIL = 32 * 1024 * 1024;

const check = (status) => (name, detail, fix) => ({ name, status, detail, ...(fix ? { fix } : {}) });
const ok = check("ok");
const warn = check("warn");
const fail = check("fail");
const info = check("info");
const skip = check("skip");

const isJevis = (cmd) => /bin[\\/]jevis\.mjs"? hook /.test(cmd ?? "");
/** A hook command's words, double quotes grouping a path with spaces. */
const commandWords = (cmd) => [...String(cmd).matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
const modeOf = (path) => statSync(path).mode & 0o777;
const ago = (ms) => (ms < 90_000 ? "just now" : ms < 90 * 60_000 ? `${Math.round(ms / 60_000)} min ago` : `${Math.round(ms / 3_600_000)} h ago`);
/** A setting safe to print: passwords, tokens, and signed-URL parameters masked as everywhere else. */
const shown = (value) => redact(String(value));

export function nodeCheck(version = process.versions.node) {
  const major = Number(version.split(".")[0]);
  return major >= 22 ? ok("node", `Node ${version}`) : fail("node", `Node ${version}: Jevis needs 22 or newer`, "install Node 22+, then run node bin/install.mjs again so the hooks use it");
}

/** One harness's hooks: every event present, pointing at a node and a checkout that exist. */
export function hookCheck(harness, file, { cli = CLI } = {}) {
  const name = `${HARNESS[harness] ?? harness} hooks`;
  const install = `node bin/install.mjs --harness ${harness}`;
  if (!existsSync(file)) return existsSync(dirname(file)) ? warn(name, `not installed: ${file} does not exist`, install) : skip(name, `${HARNESS[harness] ?? harness} is not set up on this machine`);
  let config;
  try {
    config = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    return fail(name, `${file} is not valid JSON (${String(e.message).slice(0, 80)}), so ${HARNESS[harness]} may be running no hooks at all`, `fix ${file}; the installer will not overwrite it`);
  }
  const found = {};
  for (const [event, groups] of Object.entries(config.hooks ?? {})) for (const g of groups ?? []) for (const h of g.hooks ?? []) if (isJevis(h.command)) (found[event] ??= []).push({ ...h, matcher: g.matcher });
  if (!Object.keys(found).length) return warn(name, "not installed", install);
  const want = jevisHooks(harness, { cli });
  const problems = new Set();
  const notes = new Set();
  const checkouts = new Set();
  const nodes = new Set();
  const missing = Object.keys(want).filter((e) => !found[e]);
  if (missing.length) problems.add(`no hook for ${missing.join(", ")}`);
  for (const [event, hooks] of Object.entries(found)) {
    if (hooks.length > 1) notes.add(`${event} runs Jevis ${hooks.length} times`);
    const expected = want[event]?.[0];
    for (const h of hooks) {
      const words = commandWords(h.command);
      const prefixes = words.filter((w) => /^[A-Z][A-Z0-9_]*=/.test(w));
      const [node, script] = words.filter((w) => !prefixes.includes(w));
      if (prefixes.length) notes.add(`settings on the command (${prefixes.map((p) => p.split("=")[0]).join(", ")}), which only POSIX shells run; reinstalling moves them to config.json`);
      if (node?.includes("/") || node?.includes("\\") ? !existsSync(node) : !onPath(node ?? "")) problems.add(`node not found: ${node}`);
      else nodes.add(node);
      if (!script || !existsSync(script)) problems.add(`${script} does not exist (the checkout moved or was deleted)`);
      else if (resolve(script) !== resolve(cli)) checkouts.add(script);
      if (expected?.matcher && h.matcher !== expected.matcher) notes.add(`${event} matches ${h.matcher ?? "every tool"} rather than ${expected.matcher}`);
      const wantTimeout = expected?.hooks[0].timeout;
      if (wantTimeout && h.timeout && h.timeout < wantTimeout) notes.add(`${event} times out after ${h.timeout} s; it needs ${wantTimeout} s`);
    }
  }
  if (checkouts.size) notes.add(`runs another Jevis checkout: ${[...checkouts].join(", ")}`);
  if (problems.size) return fail(name, [...problems, ...notes].join("; "), install);
  if (notes.size) return warn(name, [...notes].join("; "), install);
  return ok(name, `${Object.keys(found).length} events, ${[...nodes][0]}`);
}

/** The settings file and what is in effect: every non-default setting, with where it came from. */
export function settingsChecks(env = process.env) {
  const out = [];
  const config = readConfig();
  for (const e of config.errors) out.push(fail("settings", `${config.file}: ${e}`, config.raw === null ? `fix or remove ${config.file}; until then hooks ignore it` : `edit ${config.file}`));
  const set = settingSources(env).filter((s) => s.source !== "default");
  out.push(info("settings", set.length ? set.map((s) => `${s.key}=${shown(s.value)} (${s.source})`).join(", ") : `all defaults${config.exists ? "" : "; no config.json yet"}`));
  if (env.JEVIS_DISABLE) out.push(warn("mode", "JEVIS_DISABLE is set: every hook is off", "unset it, or remove it from config.json"));
  else if (env.JEVIS_MODE === "shadow") out.push(info("mode", "shadow: Jevis logs what it would do and changes nothing", "node bin/install.mjs --live to switch it on"));
  else out.push(ok("mode", "live"));
  return out;
}

/** Where the key comes from, never the key itself. */
function keySource(env) {
  if (env.JEVIS_JEV_KEY?.trim()) return "JEVIS_JEV_KEY";
  if (env.TYPESAFE_API_KEY?.trim()) return "TYPESAFE_API_KEY";
  const file = join(jevisHome(), "secrets", "typesafe_api_key");
  return existsSync(file) && readFileSync(file, "utf8").trim() ? file : null;
}

/** The decision model: configured, keyed, and (unless offline) answering. */
export async function jevChecks({ env = process.env, offline = false, timeoutMs = 8000 } = {}) {
  const url = jevUrl();
  const typesafe = url === TYPESAFE_URL;
  const out = [];
  const source = keySource(env);
  if (typesafe && !source) return [fail("decision model", `TypeSafe at ${url}, but no API key: every hook does nothing`, "put the key in ~/.jevis/secrets/typesafe_api_key (chmod 600), or point --jev-url at a Laya server")];
  if (source && isAbsolute(source) && modeOf(source) & 0o077) out.push(warn("api key", `${source} is readable by others (mode ${modeOf(source).toString(8)})`, `chmod 600 ${source}`));
  if (offline) return [...out, info("decision model", `${shown(url)}${source ? `, key from ${source}` : ""}; not called (--offline)`)];
  if (env.JEVIS_JEV === "off") return [...out, warn("decision model", "JEVIS_JEV=off: no calls are made", "unset JEVIS_JEV")];
  const r = await askJev({ state: { request: "jevis doctor checking the connection" }, questions: { doctor: { type: "noul", instructions: "Does `request` mention a connection check?" } }, event: "doctor", timeoutMs, record: false });
  if (!r.answers) return [...out, fail("decision model", `${shown(url)} did not answer: ${r.error}`, typesafe ? "check the key and the network (https://api.typesafe.ai)" : "check that the server is running and speaks POST /v1/systemone")];
  return [...out, ok("decision model", `${shown(url)} answered in ${r.ms} ms${source ? `, key from ${source}` : ""}`)];
}

/** ~/.jevis holds prompts and the call record: it and what is in it stay private to this user. */
export function privacyCheck(home = jevisHome()) {
  if (!existsSync(home)) return info("privacy", `${home} does not exist yet`);
  const open = [home, ...readdirSync(home).filter((f) => f !== ".DS_Store").map((f) => join(home, f))].filter((p) => modeOf(p) & 0o077);
  if (!open.length) return ok("privacy", `${home} and its contents are private`);
  return warn("privacy", `readable by other users: ${open.map((p) => `${p} (${modeOf(p).toString(8)})`).join(", ")}`, `chmod -R go-rwx ${home}`);
}

/** Whether the design and film review can run. */
export function reviewChecks({ env = process.env, tools = {} } = {}) {
  const critic = env.JEVIS_CRITIC ?? "claude";
  const line = reviewStatus(critic, tools);
  const out = [(critic === "off" ? info : /: on,/.test(line) ? ok : warn)("design review", line.replace(/^Design review: /, ""))];
  if (critic !== "off" && !(tools.ffmpeg ?? onPath("ffmpeg"))) out.push(info("film review", "ffmpeg not found: film reviews skip the soundtrack", "install ffmpeg"));
  return out;
}

/** The lessons that apply here, a trusted project's included: none broken, and untrusted project lessons noted. */
export function wikiChecks(cwd = process.cwd(), env = process.env) {
  const out = [];
  const { entries, broken } = wikiFor(cwd);
  out.push(broken.length ? fail("lessons", `${entries.length} load; broken: ${broken.map((b) => b.id).join(", ")}`, "run jevis lint in this folder to see why") : ok("lessons", `${entries.length} load`));
  const relative = String(env.JEVIS_WIKI ?? "").split(":").filter((r) => r && !isAbsolute(r));
  if (relative.length) out.push(warn("lessons", `JEVIS_WIKI folders that are not absolute are ignored: ${relative.join(", ")}`, "give each as an absolute path"));
  const project = process.env.JEVIS_WIKI ? null : projectStatus(cwd);
  if (project?.trusted) out.push(ok("project lessons", `${project.path}, trusted`));
  else if (project) out.push(warn("project lessons", `${project.path} ${project.changed ? "changed since you trusted it" : "is not trusted"}, so it does not load`, `read it, then jevis trust ${dirname(dirname(project.path))}`));
  return out;
}

/** The last day of the decision log: hooks running, and not failing. */
export function activityChecks({ now = Date.now(), file = join(jevisHome(), "log.jsonl") } = {}) {
  if (!existsSync(file)) return [warn("activity", "no hook has run yet", "start a new session: hooks load when one starts")];
  const since = now - DAY;
  const n = { rows: 0, judged: 0, errors: 0, timeouts: 0, hookErrors: 0 };
  const last = {};
  let lastAt = null;
  let lastHookError = null;
  eachJsonl(file, (r) => {
    const at = Date.parse(r.at);
    if (!Number.isFinite(at)) return;
    lastAt = r.at;
    if (at < since) return;
    n.rows += 1;
    if (r.event === "hook-error") {
      n.hookErrors += 1;
      lastHookError = r;
      return;
    }
    if (r.harness) last[r.harness] = r.at;
    if (!["prompt", "tool", "stop"].includes(r.event) || r.skipped) return;
    n.judged += 1;
    if (r.error) {
      n.errors += 1;
      if (/timeout/.test(r.error)) n.timeouts += 1;
    }
  }, { from: Math.max(0, statSync(file).size - LOG_TAIL) });
  const out = [];
  if (!n.rows) out.push(warn("activity", `nothing in the last 24 h${lastAt ? `; last event ${lastAt}` : ""}`, "start a new session in a folder Jevis covers; jevis ask checks one event by hand"));
  else out.push(ok("activity", `${n.rows} events in 24 h; last from ${Object.entries(last).map(([h, at]) => `${h} ${ago(now - Date.parse(at))}`).join(", ") || "no harness"}`));
  if (n.hookErrors) out.push(warn("hook errors", `${n.hookErrors} in 24 h (Jevis stepped aside each time); latest in ${lastHookError.hook ?? "a"} hook: ${String(lastHookError.error).split("\n")[0].slice(0, 160)}`, "the full trace is in ~/.jevis/log.jsonl (event hook-error)"));
  if (n.judged >= 5 && n.errors / n.judged > 0.1) out.push(warn("decision errors", `${n.errors} of ${n.judged} decisions failed (${n.timeouts} timeouts), and each let the call through unchecked`, n.timeouts > n.errors / 2 ? "a slow network or server: raise JEVIS_TIMEOUT_MS, or check the connection" : "run jevis doctor again to see the model's current state"));
  return out;
}

/** Every check, in the order a person would fix them. */
export async function doctor({ targets = TARGETS, cwd = process.cwd(), env = process.env, offline = false, now = Date.now(), tools = {}, cli = CLI } = {}) {
  const hooks = Object.entries(targets).map(([harness, file]) => hookCheck(harness, file, { cli }));
  if (!hooks.some((h) => h.status === "ok" || h.status === "warn")) hooks.push(fail("hooks", "Jevis is installed in no harness", "node bin/install.mjs"));
  return [nodeCheck(), ...hooks, ...settingsChecks(env), ...(await jevChecks({ env, offline })), privacyCheck(), ...reviewChecks({ env, tools }), ...wikiChecks(cwd, env), ...activityChecks({ now })];
}

const MARK = { ok: "ok  ", warn: "warn", fail: "FAIL", info: "    ", skip: "--  " };
export const formatDoctor = (checks) =>
  checks.map((c) => `${MARK[c.status]}  ${c.name}: ${c.detail}${c.fix && c.status !== "ok" ? `\n        fix: ${c.fix}` : ""}`).join("\n");
