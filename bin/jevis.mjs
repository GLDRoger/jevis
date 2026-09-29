#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { applyConfig } from "../src/config.mjs";
import { workspaceOf } from "../src/context.mjs";
import { doctor, formatDoctor } from "../src/doctor.mjs";
import { evaluate } from "../src/engine.mjs";
import { exportDataset, formatExport, TEST_SHARE } from "../src/export.mjs";
import { onPrompt, onSession, onStop, onTool } from "../src/hooks.mjs";
import { CORRECTION_MIN, formatMine, mine } from "../src/mine.mjs";
import { findSession, replay } from "../src/replay.mjs";
import { eachLog, jevisHome, log } from "../src/state.mjs";
import { formatTune, sinceTime, tune } from "../src/tune.mjs";
import { loadWiki, projectLessons, projectStatus, projectWiki, setTrust, wikiFor, wikiRoots } from "../src/wiki.mjs";

// ~/.jevis/config.json fills in any setting the environment leaves unset, before anything reads one.
applyConfig();

const [command, ...args] = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i > -1 ? args[i + 1] : undefined;
};
/** Flags that take no value. */
const SWITCHES = ["--json", "--record", "--remove", "--offline", "--agents", "--near"];
const positional = () => {
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i].startsWith("--")) {
      if (!SWITCHES.includes(args[i])) i += 1;
      continue;
    }
    out.push(args[i]);
  }
  return out;
};

const bar = (p) => `${"█".repeat(Math.round(p * 10))}${"░".repeat(10 - Math.round(p * 10))} ${p.toFixed(2)}`;

function printResult(r, { near = 5 } = {}) {
  if (r.error) console.log(`jev: ${r.error}`);
  if (r.skipped) console.log(`skipped: ${r.skipped}`);
  const axes = Object.entries(r.profile);
  if (axes.length) {
    console.log("profile");
    const width = Math.max(...axes.map(([k]) => k.length));
    for (const [k, p] of axes) console.log(`  ${k.padEnd(width)}  ${bar(p)}`);
  }
  console.log(r.fired.length ? "fires" : "fires: nothing");
  for (const e of r.fired) console.log(`  ${r.scores[e.id].toFixed(2)}  ${e.id} (${e.action}): ${e.title}`);
  const misses = Object.entries(r.scores).filter(([id]) => !r.fired.some((e) => e.id === id)).sort((a, b) => b[1] - a[1]).slice(0, near);
  if (misses.length) console.log(`closest that did not fire\n${misses.map(([id, p]) => `  ${p.toFixed(2)}  ${id}`).join("\n")}`);
  console.log(`${r.ms} ms, ${r.pool ?? 0} entries asked`);
}

const commands = {
  // Hook entry points: JSON on stdin, JSON (or nothing) on stdout. A hook never breaks the agent.
  async hook() {
    const kind = args[0];
    let input = {};
    try {
      input = JSON.parse(readFileSync(0, "utf8") || "{}");
      const run = { prompt: onPrompt, tool: onTool, stop: onStop, session: onSession }[kind];
      const output = run ? await run(input) : null;
      if (output) process.stdout.write(JSON.stringify(output));
    } catch (error) {
      log({ event: "hook-error", hook: kind, sessionId: input.session_id, error: String(error?.stack ?? error).slice(0, 1000) });
    }
  },

  // Dry run one event: jevis ask "make me a landing page" | --event tool --tool Bash "git push -f" | --event stop --request "..." "final message"
  async ask() {
    const event = flag("event") ?? "prompt";
    const text = positional().join(" ");
    if (!text) {
      console.error('usage: jevis ask [--event prompt|tool|stop] [--tool Bash] [--model <model id>] [--cwd dir] [--request "the user\'s request"] "<prompt | command | final message>"');
      process.exit(2);
    }
    const cwd = resolve(flag("cwd") ?? process.cwd());
    const model = flag("model") ?? null;
    const request = flag("request") ?? "";
    const state =
      event === "prompt"
        ? { request: text, previous_request: flag("previous") ?? null, attachments: [], workspace: workspaceOf(cwd), agent: { harness: "Codex", model, origin: "person" } }
        : event === "tool"
        ? { request, tool: flag("tool") ?? "Bash", input: text, workspace: workspaceOf(cwd) }
        : { request, final_message: text, evidence: JSON.parse(flag("evidence") ?? '{"edited":false,"files_changed":[],"files_changed_count":0,"ui_files_changed":[],"actions_after_last_edit":[],"recent_actions":[],"commands_run":0,"used_subagents":false}') };
    const r = await evaluate({ event, state, tool: event === "tool" ? state.tool : null, model, record: args.includes("--record"), wiki: wikiFor(cwd) });
    if (args.includes("--json")) console.log(JSON.stringify({ ...r, fired: r.fired.map((e) => e.id) }, null, 2));
    else printResult(r);
  },

  lint() {
    // A project's lessons are linted here whether or not they are trusted yet, so their author can check them first.
    const project = process.env.JEVIS_WIKI ? null : projectStatus(process.cwd());
    const roots = [...wikiRoots(), ...(project ? [project.path] : [])];
    const { entries, broken, replaced, off } = loadWiki(roots, { guarded: project ? [project.path] : [] });
    const by = (k) => Object.entries(entries.reduce((m, e) => ((m[e[k]] = (m[e[k]] ?? 0) + 1), m), {})).map(([a, n]) => `${a} ${n}`).join(", ");
    console.log(`wikis: ${wikiRoots().map((r) => (existsSync(r) ? r : `${r} (none yet)`)).join(", ")}`);
    if (project) console.log(`project: ${project.path} (${trustWord(project)})`);
    console.log(`${entries.length} entries (${by("event")}; ${by("action")})`);
    for (const id of replaced) console.log(`replaced ${id}`);
    for (const id of off) console.log(`off      ${id}`);
    for (const b of broken) console.log(`BROKEN ${b.id} (${b.file}): ${b.errors.join("; ")}`);
    const perEvent = entries.reduce((m, e) => ((m[e.event] = (m[e.event] ?? 0) + 1), m), {});
    for (const [ev, n] of Object.entries(perEvent)) if (n > 200) console.log(`note: ${ev} has ${n} entries; calls split into parallel chunks of 200`);
    // A Bash entry without this gate is asked about every ls and git log: correct, but each one waits on the decision model.
    const ungated = entries.filter((e) => e.event === "tool" && e.tools?.includes("Bash") && e.when?.["marks.plain_read"] !== false);
    for (const e of ungated) console.log(`note: ${e.id} applies to Bash without when { marks.plain_read: false }, so every plain read (ls, rg, git log) asks it; add the gate unless it is about reads`);
    process.exit(broken.length ? 1 : 0);
  },

  // Is Jevis installed and working? jevis doctor [--offline] [--json]
  async doctor() {
    const checks = await doctor({ offline: args.includes("--offline") });
    console.log(args.includes("--json") ? JSON.stringify(checks, null, 2) : formatDoctor(checks));
    process.exit(checks.some((c) => c.status === "fail") ? 1 : 0);
  },

  // Turns a person corrected, as material for new lessons: jevis mine [--since 7d] [--min 0.6] [--agents] [--limit 30] [--json]
  mine() {
    const result = mine({ since: sinceTime(flag("since")), min: Number(flag("min") ?? CORRECTION_MIN), agents: args.includes("--agents"), limit: Number(flag("limit") ?? 30) });
    console.log(args.includes("--json") ? JSON.stringify(result, null, 2) : formatMine(result));
  },

  // The call record as a Laya training set: jevis export [--out dir] [--events prompt,tool,stop] [--since 7d] [--test 0.1]
  export() {
    const out = resolve(flag("out") ?? join(jevisHome(), "export", new Date().toISOString().slice(0, 10)));
    const share = Number(flag("test") ?? TEST_SHARE);
    if (!(share >= 0 && share < 1)) {
      console.error("--test is the share of sessions held out, from 0 to below 1");
      process.exit(2);
    }
    const result = exportDataset({ out, events: (flag("events") ?? "prompt,tool,stop").split(","), since: sinceTime(flag("since")), testShare: share });
    console.log(args.includes("--json") ? JSON.stringify(result, null, 2) : formatExport(result));
  },

  // Trust a project's lessons (<repo>/.jevis/wiki) as they are now: jevis trust [dir] | --remove [dir]
  trust() {
    const dir = resolve(positional()[0] ?? process.cwd());
    const path = projectWiki(dir);
    if (!path) {
      console.error(`no .jevis/wiki at or above ${dir}`);
      process.exit(2);
    }
    if (args.includes("--remove")) {
      setTrust(path, { remove: true });
      return console.log(`${path}: no longer trusted; its lessons stop loading.`);
    }
    const l = projectLessons(path);
    console.log(path);
    for (const e of l.added) console.log(`  + ${e.id} (${e.event}, ${e.action}): ${e.title}`);
    for (const e of l.replaced) console.log(`  ~ ${e.id} replaces the default (${e.event}, ${e.action}): ${e.title}`);
    for (const id of l.off) console.log(`  - ${id} turned off`);
    for (const b of l.broken) console.log(`  ! ${b.id} ignored: ${b.errors.join("; ")}`);
    if (!l.added.length && !l.replaced.length && !l.off.length) console.log("  (no lessons that change anything)");
    const record = setTrust(path);
    console.log(`Trusted as it is now (${record.hash}). Jevis loads these lessons from the next hook on; a change to any file there needs jevis trust again.`);
  },

  // Dry run a recorded session: jevis replay <file | session id> [--events prompt,tool,stop] [--limit n] [--json]
  async replay() {
    const target = positional()[0];
    const path = target && findSession(target);
    if (!path) {
      console.error(target ? `no session found for ${target}` : "usage: jevis replay <session file | id> [--events prompt,tool,stop] [--limit n] [--json]");
      process.exit(2);
    }
    const events = (flag("events") ?? "prompt,tool,stop").split(",");
    const report = await replay(path, { events, limit: Number(flag("limit") ?? Infinity), record: args.includes("--record") });
    if (args.includes("--json")) {
      const slim = (r) => r && { ms: r.ms, error: r.error, profile: r.profile, fired: r.fired.map((e) => ({ id: e.id, p: r.scores[e.id] })) };
      console.log(JSON.stringify({ ...report, turns: report.turns.map((t) => ({ ...t, prompt: slim(t.prompt), stop: t.stop && { final: t.stop.final, ...slim(t.stop) }, tools: t.tools.map((x) => ({ tool: x.tool, input: x.input, ...slim(x) })) })) }, null, 2));
      return;
    }
    console.log(`${report.harness} · ${report.model ?? "unknown model"} · ${report.turns.length} turns · ${path}`);
    for (const t of report.turns) {
      console.log(`\n#${t.turn} ${t.request}`);
      const fired = (r) => r.fired.map((e) => `${e.id}@${r.scores[e.id].toFixed(2)}`).join(", ");
      if (t.prompt) console.log(`  prompt: ${t.prompt.error ? `error ${t.prompt.error}` : fired(t.prompt) || "-"}`);
      for (const x of t.tools) console.log(`  tool ${x.tool}: ${x.error ? `error ${x.error}` : fired(x)}  ← ${x.input.replace(/\s+/g, " ")}`);
      if (t.stop) console.log(`  stop: ${t.stop.error ? `error ${t.stop.error}` : fired(t.stop) || "-"}`);
    }
  },

  // What Jevis did: fires per entry, latency, errors. --near: each lesson against the recorded answers, for tuning its min.
  // Totals as it streams the log, which grows by megabytes a day: only the latencies are held.
  stats() {
    if (args.includes("--near")) {
      const result = tune(wikiFor(process.cwd()).entries, { since: sinceTime(flag("since")) });
      return console.log(args.includes("--json") ? JSON.stringify(result, null, 2) : formatTune(result));
    }
    const ms = [];
    const counts = {};
    const n = { events: 0, errors: 0, tools: 0, skipped: 0, plain: 0 };
    eachLog((r) => {
      if (!["prompt", "tool", "stop"].includes(r.event)) return;
      n.events += 1;
      if (r.ms) ms.push(r.ms);
      if (r.error) n.errors += 1;
      if (r.event === "tool") {
        n.tools += 1;
        if (r.skipped) n.skipped += 1;
        if (r.plain_read) n.plain += 1;
      }
      for (const id of r.acted ?? []) counts[id] = (counts[id] ?? 0) + 1;
    });
    ms.sort((a, b) => a - b);
    const pct = (p) => ms[Math.floor(ms.length * p)] ?? 0;
    console.log(`${n.events} events, jev p50 ${pct(0.5)} ms, p95 ${pct(0.95)} ms, errors ${n.errors}`);
    if (n.tools) console.log(`${n.tools} tool calls: ${n.tools - n.skipped} judged, ${n.skipped} skipped without a call (${n.plain} plain reads)`);
    for (const [id, k] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${String(k).padStart(4)}  ${id}`);
  },
};

function trustWord(project) {
  if (project.trusted) return "trusted";
  return project.changed ? "changed since you trusted it: not loaded until jevis trust" : "not trusted: not loaded until jevis trust";
}

if (!commands[command]) {
  console.error("usage: jevis <hook prompt|tool|stop|session | ask | doctor | lint | trust | replay | stats [--near] | mine | export>");
  process.exit(2);
}
await commands[command]();
