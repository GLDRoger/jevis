import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { EDIT_CLIP, clip, inputMarks, harnessWritten, requestText, toolInput, turnEvidence } from "./context.mjs";
import { evaluate } from "./engine.mjs";
import { commandText, readSession } from "./transcript.mjs";
import { loadWiki } from "./wiki.mjs";

/**
 * Dry-run a recorded session through Jevis: every user turn as a prompt event,
 * every command and edit as a tool event, every turn's end as a stop event.
 * Nothing is injected and, by default, nothing is recorded as training data.
 * This is how entries are judged before they reach a live session.
 */

const text = (it) => (it.content ?? []).map((c) => c.text ?? "").join("");

/** A session log as user turns: the request and the items until the next one. */
export function sessionTurns(path) {
  const session = readSession(path);
  const turns = [];
  for (const item of session.items) {
    if (item.it.type === "UserMessage") {
      const words = text(item.it);
      if (!harnessWritten(words) && requestText(words)) {
        turns.push({ request: requestText(words), raw: words, at: item.t, items: [] });
        continue;
      }
    }
    turns.at(-1)?.items.push(item);
  }
  const turnContext = session.rows.find((r) => r.type === "turn_context")?.payload;
  const meta = session.rows.find((r) => r.type === "session_meta")?.payload;
  return { turns, model: session.meta?.model ?? turnContext?.model ?? null, harness: session.meta?.harness ?? "Codex", cwd: meta?.cwd ?? turnContext?.cwd ?? null };
}

/** A tool event as the hook would see it, from a logged command or edit. */
function toolEvent(it, harness) {
  if (it.type === "CommandExecution") return { tool: "Bash", input: clip(commandText(it), EDIT_CLIP) };
  if (it.type !== "FileChange") return null;
  if (harness === "Codex") {
    // Shown as the live hook shows apply_patch: the file header and only the lines the edit adds.
    const [path, change] = Object.entries(it.changes ?? {})[0] ?? [];
    if (!path) return null;
    const added = change?.content ?? (change?.unified_diff ?? "").split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).map((l) => l.slice(1)).join("\n");
    return { tool: "apply_patch", input: clip(`*** ${change?.type === "add" ? "Add" : "Update"} File: ${path}\n${added}`, EDIT_CLIP) };
  }
  if (it.tool && it.input) return { tool: it.tool, input: toolInput(it.tool, it.input) };
  const path = it.changes?.[0]?.path;
  return path ? { tool: "Edit", input: toolInput("Edit", { file_path: path }) } : null;
}

async function pool(tasks, width = 6) {
  const out = new Array(tasks.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(width, tasks.length) }, async () => {
    while (next < tasks.length) {
      const i = next++;
      out[i] = await tasks[i]();
    }
  }));
  return out;
}

export async function replay(path, { events = ["prompt", "tool", "stop"], limit = Infinity, record = false, width = 6 } = {}) {
  const wiki = loadWiki();
  const { turns, model, harness, cwd } = sessionTurns(path);
  const picked = turns.slice(0, limit);
  const tasks = [];
  const results = picked.map((t, i) => ({ turn: i + 1, request: clip(t.request, 160), prompt: null, tools: [], stop: null }));
  picked.forEach((t, i) => {
    const workspace = { git: null, files: [], empty: null }; // the folder as it was then is unknown
    if (events.includes("prompt")) {
      const state = { request: clip(t.request, 2000), previous_request: i ? clip(picked[i - 1].request, 600) : null, attachments: [], workspace, agent: { harness, model, origin: "person" } };
      tasks.push(async () => {
        results[i].prompt = await evaluate({ event: "prompt", state, model, harness, record, wiki });
      });
    }
    if (events.includes("tool")) {
      for (const { it } of t.items) {
        const ev = toolEvent(it, harness);
        if (!ev) continue;
        const state = { request: clip(t.request, 2000), tool: ev.tool, input: ev.input, marks: inputMarks(ev.input), workspace };
        tasks.push(async () => {
          const r = await evaluate({ event: "tool", state, tool: ev.tool, model, harness, record, wiki });
          if (r.fired.length || r.error) results[i].tools.push({ tool: ev.tool, input: ev.input, ...r });
        });
      }
    }
    if (events.includes("stop")) {
      const finals = t.items.filter(({ it }) => it.type === "AgentMessage");
      const final = finals.length ? text(finals.at(-1).it) : "";
      if (final) {
        const state = { request: clip(t.request, 2000), final_message: clip(final, 3000), evidence: turnEvidence(t.items, { cwd }) };
        tasks.push(async () => {
          results[i].stop = { final: clip(final, 160), ...(await evaluate({ event: "stop", state, model, harness, record, wiki })) };
        });
      }
    }
  });
  await pool(tasks, width);
  return { path, harness, model, turns: results };
}

/** A session file from a path or an id fragment, searching Codex and Claude Code logs. */
export function findSession(target) {
  if (existsSync(target)) return target;
  const roots = [join(homedir(), ".codex", "sessions"), join(homedir(), ".claude", "projects")];
  const walk = (dir, depth = 0) => {
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory() && depth < 4 && e.name !== "subagents") {
        const hit = walk(p, depth + 1);
        if (hit) return hit;
      } else if (e.name.endsWith(".jsonl") && basename(e.name).includes(target)) return p;
    }
    return null;
  };
  for (const root of roots) {
    const hit = walk(root);
    if (hit) return hit;
  }
  return null;
}
