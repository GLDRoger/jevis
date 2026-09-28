#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { workspaceOf } from "../src/context.mjs";
import { evaluate } from "../src/engine.mjs";
import { onPrompt, onSession, onStop, onTool } from "../src/hooks.mjs";
import { findSession, replay } from "../src/replay.mjs";
import { log, readLog } from "../src/state.mjs";
import { loadWiki, wikiRoots } from "../src/wiki.mjs";

const [command, ...args] = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i > -1 ? args[i + 1] : undefined;
};
const positional = () => {
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i].startsWith("--")) {
      if (!["--json", "--record"].includes(args[i])) i += 1;
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
    const r = await evaluate({ event, state, tool: event === "tool" ? state.tool : null, model, record: args.includes("--record") });
    if (args.includes("--json")) console.log(JSON.stringify({ ...r, fired: r.fired.map((e) => e.id) }, null, 2));
    else printResult(r);
  },

  lint() {
    const { entries, broken, replaced, off } = loadWiki();
    const by = (k) => Object.entries(entries.reduce((m, e) => ((m[e[k]] = (m[e[k]] ?? 0) + 1), m), {})).map(([a, n]) => `${a} ${n}`).join(", ");
    console.log(`wikis: ${wikiRoots().map((r) => (existsSync(r) ? r : `${r} (none yet)`)).join(", ")}`);
    console.log(`${entries.length} entries (${by("event")}; ${by("action")})`);
    for (const id of replaced) console.log(`replaced ${id}`);
    for (const id of off) console.log(`off      ${id}`);
    for (const b of broken) console.log(`BROKEN ${b.id} (${b.file}): ${b.errors.join("; ")}`);
    const perEvent = entries.reduce((m, e) => ((m[e.event] = (m[e.event] ?? 0) + 1), m), {});
    for (const [ev, n] of Object.entries(perEvent)) if (n > 200) console.log(`note: ${ev} has ${n} entries; calls split into parallel chunks of 200`);
    process.exit(broken.length ? 1 : 0);
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

  // What Jevis did: fires per entry, latency, errors.
  stats() {
    const rows = readLog().filter((r) => ["prompt", "tool", "stop"].includes(r.event));
    const ms = rows.filter((r) => r.ms).map((r) => r.ms).sort((a, b) => a - b);
    const pct = (p) => ms[Math.floor(ms.length * p)] ?? 0;
    console.log(`${rows.length} events, jev p50 ${pct(0.5)} ms, p95 ${pct(0.95)} ms, errors ${rows.filter((r) => r.error).length}`);
    const counts = {};
    for (const r of rows) for (const id of r.acted ?? []) counts[id] = (counts[id] ?? 0) + 1;
    for (const [id, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${id}`);
  },
};

if (!commands[command]) {
  console.error("usage: jevis <hook prompt|tool|stop|session | ask | lint | replay | stats>");
  process.exit(2);
}
await commands[command]();
