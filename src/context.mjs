import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { commandText, readSession } from "./transcript.mjs";

/**
 * Turns a hook's input into the state Jev reads. Only facts live here:
 * parsing, file listings, and the session log. Every judgement about what a
 * request or a command means is Jev's.
 */

/** Codex puts the model in the hook input; Claude Code only records it in the transcript. */
export function harnessOf(input, { withModel = true } = {}) {
  if (input.model) return { harness: "Codex", model: String(input.model) };
  const claude = /[\\/]\.claude[\\/]projects[\\/]/.test(input.transcript_path ?? "") || "permission_mode" in input;
  return { harness: claude ? "Claude Code" : "Codex", model: claude && withModel ? tailModel(input.transcript_path) : null };
}

/** The model from the end of a Claude Code transcript, without reading a long file whole. */
export function tailModel(path, bytes = 262144) {
  if (!path || !existsSync(path)) return null;
  let fd;
  try {
    const size = statSync(path).size;
    const len = Math.min(size, bytes);
    const buf = Buffer.alloc(len);
    fd = openSync(path, "r");
    readSync(fd, buf, 0, len, size - len);
    const found = [...buf.toString("utf8").matchAll(/"model":"(claude-[^"]+)"/g)].map((m) => m[1]).filter((m) => !/synthetic/.test(m));
    return found.at(-1) ?? null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Prompts the harness writes itself (a background agent finishing, a slash command's output): not a person's request. */
const HARNESS_WRAPPER = /^\s*<(task-notification|system-reminder|command-name|command-message|command-args|local-command-[a-z]+|subagent_notification|bash-input|bash-stdout|bash-stderr|user-prompt-submit-hook)\b/;
export const harnessWritten = (prompt) => HARNESS_WRAPPER.test(String(prompt ?? ""));

/** Started by another agent: a broker job, or a headless CLI call that set AGENT_CALL_DEPTH. */
export function originOf(prompt, env = process.env) {
  if (env.BROKER_JOB_ID !== undefined || env.BROKER_DEPTH !== undefined || Number(env.AGENT_CALL_DEPTH) > 0) return "agent";
  return /^\s*\[[\w-]*(agent|broker)[\w-]*\]/i.test(String(prompt ?? "")) ? "agent" : "person";
}

/** The user's words without the harness's attachment preamble and image tags. */
export function requestText(prompt) {
  const text = String(prompt ?? "");
  const mine = text.match(/## My request:\s*([\s\S]*)$/);
  return (mine ? mine[1] : text).replace(/<image\b[^>]*>(\s*<\/image>)?/g, "").replace(/&#x20;/g, " ").trim();
}

/** Attachment names: Codex's "## name: /path" lines, <image name=…> tags, and Claude Code's [Image #n]. */
export function attachmentNames(prompt) {
  const text = String(prompt ?? "");
  const names = [
    ...[...text.matchAll(/^##\s+([^\n]*?):\s+\/[^\n]*$/gm)].map((m) => m[1]),
    ...[...text.matchAll(/<image name=(?:\[([^\]]+)\]|([^\s>]+))/g)].map((m) => m[1] ?? m[2]),
    ...[...text.matchAll(/\[(Image #\d+)\]/g)].map((m) => m[1]),
  ];
  return [...new Set(names.filter((n) => n && n !== "My request"))];
}

/** The folder the agent works in: is it a repository, and what is at its top level. */
export function workspaceOf(cwd) {
  if (!cwd) return { git: false, files: [], empty: true };
  let git = false;
  for (let d = cwd; d && d !== dirname(d); d = dirname(d)) {
    if (existsSync(join(d, ".git"))) {
      git = true;
      break;
    }
  }
  let files = [];
  try {
    files = readdirSync(cwd, { withFileTypes: true })
      .filter((e) => !e.name.startsWith(".") || e.name === ".github")
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      .sort();
  } catch {
    /* gone or unreadable */
  }
  return { git, files: files.slice(0, 40), empty: files.length === 0 };
}

const clip = (s, n) => {
  const t = String(s ?? "");
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

/** What a tool call is about to do, short enough for Jev to read in full. */
/**
 * What a tool call does, as Jev reads it. Edits show only what they add: a
 * slop check must judge the new lines, not the ones an edit removes or keeps.
 */
export const EDIT_CLIP = 4000;
export function toolInput(tool, input) {
  if (input == null) return "";
  if (typeof input === "string") return clip(input, 1500);
  if (typeof input.command === "string") return clip(input.command, EDIT_CLIP);
  if (Array.isArray(input.command)) return clip(input.command.at(-1), EDIT_CLIP);
  if (input.file_path || input.notebook_path) {
    const body = input.content ?? input.new_string ?? input.new_source ?? (Array.isArray(input.edits) ? input.edits.map((e) => e.new_string).join("\n…\n") : "");
    return clip(`${tool} ${input.file_path ?? input.notebook_path}\n${body}`, EDIT_CLIP);
  }
  if (typeof input.input === "string") return clip(patchAdditions(input.input), EDIT_CLIP); // apply_patch
  return clip(JSON.stringify(input), 1500);
}

/**
 * Characters a check needs exactly: Jev reads an en dash (–) as an em dash (—)
 * often enough that the em-dash rule gates on this fact instead.
 */
/**
 * Facts code can compute exactly, so no entry has to ask Jev for them:
 * em_dash, the character itself (Jev confuses it with an en dash), and
 * ran_before, whether this session already ran this exact command.
 */
export const inputMarks = (input, { ranBefore = false } = {}) => ({ em_dash: /\u2014/.test(String(input ?? "")), ran_before: ranBefore });

/** A command's identity for ran_before: whitespace-insensitive, and short enough to keep a session's worth. */
export const commandKey = (command) => createHash("sha256").update(String(command ?? "").replace(/\s+/g, " ").trim()).digest("hex").slice(0, 16);

/** An apply_patch body reduced to its file headers and added lines. */
export function patchAdditions(patch) {
  const out = [];
  for (const line of patch.split("\n")) {
    if (/^\*\*\* (Add|Update|Delete) File: /.test(line) || /^\*\*\* Move to: /.test(line)) out.push(line);
    else if (line.startsWith("+")) out.push(line.slice(1));
  }
  return out.join("\n");
}

const UI_FILE = /\.(tsx|jsx|vue|svelte|astro|html|css|scss)$/;
const TEST_PATH = /(\.(test|spec|stories)\.[cm]?[jt]sx?$|(^|\/)(__tests__|tests?|__mocks__|e2e)\/)/;

function describe(it, cwd) {
  if (it.type === "CommandExecution") return `exit ${it.exit_code ?? "?"}: ${clip(commandText(it).replace(/\s+/g, " "), 180)}`;
  if (it.type === "McpToolCall") {
    const args = it.arguments && typeof it.arguments === "object" ? it.arguments : {};
    const what = [args.title, args.code ?? args.url ?? args.command ?? args.query].filter(Boolean).map(String).join(": ");
    return `tool ${it.server}.${it.tool}${what ? ` ${clip(what.replace(/\s+/g, " "), 180)}` : ""}`;
  }
  if (it.type === "ImageView") return `viewed image ${basename(it.path ?? "")}`;
  if (it.type === "SubAgentActivity" || it.type === "CollabAgentToolCall") return `ran a subagent${it.agent_type ? ` (${it.agent_type})` : ""}`;
  if (it.type === "FileChange") return `edited ${changedPaths(it, cwd).join(", ")}`;
  return null;
}

function changedPaths(it, cwd) {
  const paths = Array.isArray(it.changes) ? it.changes.map((c) => c.path ?? "") : Object.keys(it.changes ?? {});
  return paths.filter(Boolean).map((p) => (cwd && isAbsolute(p) && p.startsWith(`${cwd}/`) ? relative(cwd, p) : p));
}

/**
 * What this turn did, from the session log (subagents included): the files it
 * changed and the actions after its last edit. Facts only; Jev decides whether
 * they back what the final message claims.
 */
export function turnEvidence(items, { since = 0, cwd = null } = {}) {
  const turn = items.filter(({ t }) => !since || (t || 0) >= since);
  let lastEdit = -1;
  turn.forEach(({ it }, i) => {
    if (it.type === "FileChange") lastEdit = i;
  });
  const files = [...new Set(turn.filter(({ it }) => it.type === "FileChange").flatMap(({ it }) => changedPaths(it, cwd)))];
  const actions = (list) => list.map(({ it }) => describe(it, cwd)).filter(Boolean);
  const after = lastEdit >= 0 ? actions(turn.slice(lastEdit + 1).filter(({ it }) => it.type !== "FileChange")) : [];
  return {
    edited: lastEdit >= 0,
    files_changed: files.slice(0, 20),
    files_changed_count: files.length,
    ui_files_changed: files.filter((f) => UI_FILE.test(f) && !TEST_PATH.test(f)).slice(0, 10),
    actions_after_last_edit: after.slice(-15),
    recent_actions: actions(turn).slice(-12),
    commands_run: turn.filter(({ it }) => it.type === "CommandExecution").length,
    used_subagents: turn.some(({ it }) => it.type === "SubAgentActivity" || it.type === "CollabAgentToolCall"),
  };
}

const SKIP_DIRS = new Set(["node_modules", "dist", "build", "out", "coverage", "vendor", "target", "__pycache__"]);

/**
 * Files under `root` modified since `since`: what the turn wrote however it
 * wrote it (a heredoc, a script, a JavaScript exec), which the session log
 * only records for patch and edit tools. Bounded, skips dependency and hidden
 * folders, and never walks the home folder itself.
 */
export function touchedFiles(root, since, { limit = 5000, depth = 5 } = {}) {
  if (!root || !since || root === homedir() || !existsSync(root)) return [];
  const out = [];
  let seen = 0;
  const walk = (dir, level) => {
    if (level > depth || seen > limit) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (++seen > limit) return;
      if (e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
      const path = join(dir, e.name);
      if (e.isDirectory()) walk(path, level + 1);
      else if (e.isFile()) {
        try {
          if (statSync(path).mtimeMs >= since) out.push(relative(root, path));
        } catch {
          /* gone since the listing */
        }
      }
    }
  };
  walk(root, 0);
  return out;
}

/** Turn evidence plus files the log missed because a command, not an edit tool, wrote them. */
export function withTouched(evidence, cwd, since) {
  const extra = touchedFiles(cwd, since).filter((f) => !evidence.files_changed.includes(f));
  if (!extra.length) return evidence;
  const ui = extra.filter((f) => UI_FILE.test(f) && !TEST_PATH.test(f));
  return {
    ...evidence,
    edited: true,
    files_changed: [...evidence.files_changed, ...extra].slice(0, 20),
    files_changed_count: evidence.files_changed_count + extra.length,
    ui_files_changed: [...evidence.ui_files_changed, ...ui].slice(0, 10),
    files_written_by_commands: extra.slice(0, 20),
  };
}

/** The session's items from byte `from` (where this turn began), subagents since `since`; null when there is no readable log. */
export function sessionItems(path, { from = 0, since = 0 } = {}) {
  try {
    return path ? readSession(path, { from, since }).items : null;
  } catch {
    return null;
  }
}

/** A transcript's current size: the prompt hook records it so the Stop hook reads only this turn. */
export function transcriptSize(path) {
  try {
    return path ? statSync(path).size : 0;
  } catch {
    return 0;
  }
}

/** The last thing the agent said, when the harness does not send it. */
export function lastAgentMessage(items) {
  for (let i = (items?.length ?? 0) - 1; i >= 0; i -= 1) {
    const { it } = items[i];
    if (it.type === "AgentMessage") return (it.content ?? []).map((c) => c.text ?? "").join("");
  }
  return "";
}

/** When the current turn began, from the log: the last user message. */
export function lastUserMessageAt(items) {
  for (let i = (items?.length ?? 0) - 1; i >= 0; i -= 1) if (items[i].it.type === "UserMessage") return items[i].t;
  return 0;
}

export { clip };

/** The turn's raw commands and tool arguments, where a reviewer looks for the local URL the agent served or opened. */
export function turnTexts(items, { since = 0 } = {}) {
  const out = [];
  for (const { it, t } of items ?? []) {
    if (since && (t || 0) < since) continue;
    if (it.type === "CommandExecution") out.push(commandText(it), String(it.aggregated_output ?? "").slice(-4000));
    else if (it.type === "McpToolCall" && it.arguments) out.push(JSON.stringify(it.arguments));
  }
  return out.filter(Boolean);
}
