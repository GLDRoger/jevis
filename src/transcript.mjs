import { closeSync, existsSync, fstatSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { StringDecoder } from "node:string_decoder";

/**
 * Reads a session transcript into the items Jevis needs: commands with exit
 * codes and output, file changes, MCP tool calls, agent messages, user
 * prompts, and image views, each with a timestamp.
 *
 * Two formats: a Codex rollout (event_msg item_completed rows) and a Claude
 * Code transcript (assistant tool_use blocks answered by user tool_result
 * blocks). Claude Code sessions are translated into the Codex item shapes, so
 * every gate reads one vocabulary.
 */

/**
 * The rows of a JSONL log from byte `from` on, read in chunks: session logs
 * reach several gigabytes (the largest Codex rollout here is 2.7 GB), past what
 * one string can hold. `keep` skips lines before parsing them. A line cut by
 * `from` (one that does not start right after a newline) or still being
 * written is skipped. A character split across two chunks is decoded whole.
 */
export function readJsonl(file, options = {}) {
  const rows = [];
  eachJsonl(file, (row) => rows.push(row), options);
  return rows;
}

/** readJsonl without holding the rows: `fn` sees each one in turn, so a reader can total a log of any size. */
export function eachJsonl(file, fn, { from = 0, keep = null } = {}) {
  if (!file || !existsSync(file)) return;
  const fd = openSync(file, "r");
  try {
    const size = fstatSync(fd).size;
    const buf = Buffer.alloc(8 * 1024 * 1024);
    const decoder = new StringDecoder("utf8");
    let pos = Math.max(0, Math.min(from, size));
    let rest = "";
    // The prompt hook records the size at a row's end, so `from` usually starts a whole row; only a cut one is dropped.
    let cut = pos > 0 && readSync(fd, buf, 0, 1, pos - 1) === 1 && buf[0] !== 0x0a;
    while (pos < size) {
      const n = readSync(fd, buf, 0, Math.min(buf.length, size - pos), pos);
      if (!n) break;
      pos += n;
      const lines = (rest + decoder.write(buf.subarray(0, n))).split("\n");
      rest = lines.pop();
      for (const line of lines) {
        if (cut) { cut = false; continue; }
        if (!line || (keep && !keep(line))) continue;
        let row;
        try { row = JSON.parse(line); } catch { continue; /* partial or corrupt line */ }
        fn(row);
      }
    }
    rest += decoder.end();
    if (rest && !cut && (!keep || keep(rest))) {
      let row;
      try { row = JSON.parse(rest); } catch { /* still being written */ }
      if (row !== undefined) fn(row);
    }
  } finally {
    closeSync(fd);
  }
}

/** Rows a reader uses: Codex items and metadata, Claude Code messages. Everything else (token counts, reasoning, deltas) is skipped unparsed. */
const USEFUL = (line) => line.includes('"item_completed"') || line.includes('"session_meta"') || line.includes('"turn_context"') || line.includes('"type":"assistant"') || line.includes('"type":"user"');

const isClaudeRow = (r) => (r.type === "assistant" || r.type === "user") && r.message && typeof r.message === "object";

export function readRollout(path, { from = 0 } = {}) {
  const rows = readJsonl(path, { from, keep: USEFUL });
  if (!rows.some((r) => r.type === "event_msg") && rows.some(isClaudeRow)) return readClaudeTranscript(rows);
  const meta = rows.find((r) => r.type === "session_meta")?.payload ?? {};
  const items = [];
  const seen = new Set();
  for (const r of rows) {
    if (r.type !== "event_msg" || r.payload?.type !== "item_completed") continue;
    const it = r.payload.item;
    if (!it || seen.has(it.id) || !applied(it)) continue;
    seen.add(it.id);
    items.push({ at: r.timestamp, t: Date.parse(r.timestamp), it });
  }
  return { rows, meta, items };
}

/** A file change that did not happen (a patch that failed, or one the user or a hook refused) is not evidence of an edit. */
const FAILED = /^(failed|declined|rejected|error|errored|cancell?ed)$/i;
const applied = (it) => it.type !== "FileChange" || !FAILED.test(String(it.status ?? ""));

const IMAGE_FILE = /\.(png|jpe?g|gif|webp)$/i;
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const READ_ONLY_AGENTS = new Set(["Explore", "Plan", "claude-code-guide", "statusline-setup"]);

const resultText = (content) => (typeof content === "string" ? content : Array.isArray(content) ? content.map((c) => (c.type === "text" ? c.text : "")).join("\n") : "");

/** A Claude Code transcript as Codex-shaped items. A tool call counts when its result arrives. Subagent files are all sidechain rows, so reading one keeps them. */
export function readClaudeTranscript(rows, { sidechain = false } = {}) {
  const pending = new Map();
  const items = [];
  let model = null;
  const push = (at, it) => items.push({ at, t: Date.parse(at), it });
  for (const r of rows) {
    if (!isClaudeRow(r) || (r.isSidechain && !sidechain)) continue;
    const content = r.message.content;
    if (r.type === "assistant") {
      if (r.message.model && !/synthetic/.test(r.message.model)) model = r.message.model;
      for (const block of Array.isArray(content) ? content : []) {
        if (block.type === "text" && block.text?.trim()) push(r.timestamp, { type: "AgentMessage", id: `${r.uuid}-text`, content: [{ type: "output_text", text: block.text }] });
        if (block.type === "tool_use") pending.set(block.id, { at: r.timestamp, block });
      }
      continue;
    }
    // user rows: a typed prompt, or the results of earlier tool calls.
    if (typeof content === "string") {
      if (!r.isMeta && !/^\s*<(command|local-command|system-reminder)/.test(content)) push(r.timestamp, { type: "UserMessage", id: r.uuid, content: [{ type: "input_text", text: content }] });
      continue;
    }
    // A typed prompt with attachments arrives as blocks: keep the words, and each image as a name only.
    const blocks = Array.isArray(content) ? content : [];
    if (!r.isMeta && blocks.some((b) => b.type === "text") && !blocks.some((b) => b.type === "tool_result")) {
      let n = 0;
      const text = blocks.map((b) => (b.type === "text" ? b.text : b.type === "image" ? `[Image #${++n}]` : b.type === "document" ? `[${b.title ?? "Document"}]` : "")).filter(Boolean).join("\n");
      if (!/^\s*<(command|local-command|system-reminder)/.test(text)) push(r.timestamp, { type: "UserMessage", id: r.uuid, content: [{ type: "input_text", text }] });
      continue;
    }
    for (const block of blocks) {
      if (block.type !== "tool_result") continue;
      const call = pending.get(block.tool_use_id);
      if (!call) continue;
      pending.delete(block.tool_use_id);
      const it = toItem(call.block, block, r.toolUseResult);
      if (it) push(r.timestamp, it);
    }
  }
  // Calls still running at Stop count from when they were made.
  for (const { at, block } of pending.values()) {
    const it = toItem(block, null, null);
    if (it) push(at, it);
  }
  items.sort((a, b) => a.t - b.t);
  return { rows, meta: { model, harness: "Claude Code" }, items };
}

function toItem(call, result, detail) {
  const { id, name, input = {} } = call;
  const output = result ? resultText(result.content) : "";
  if (name === "Bash") {
    const code = result?.is_error ? Number(output.match(/Exit code (\d+)/)?.[1] ?? 1) : result ? 0 : null;
    const stdout = detail && typeof detail === "object" ? [detail.stdout, detail.stderr].filter(Boolean).join("\n") : "";
    return { type: "CommandExecution", id, command: String(input.command ?? ""), aggregated_output: stdout || output, exit_code: code };
  }
  // The tool name and input ride along so a replay can show Jev the edit exactly as the live hook did.
  // An edit that errored (old_string not found, or refused by a hook such as Jevis's own deny) changed nothing.
  if (EDIT_TOOLS.has(name)) return result?.is_error ? null : { type: "FileChange", id, tool: name, input, changes: [{ path: String(input.file_path ?? input.notebook_path ?? "") }] };
  if (name?.startsWith("mcp__")) {
    const [, server, ...tool] = name.split("__");
    return { type: "McpToolCall", id, server, tool: tool.join("__"), arguments: input };
  }
  if (name === "Read" && IMAGE_FILE.test(String(input.file_path ?? ""))) return { type: "ImageView", id, path: String(input.file_path) };
  // A subagent that can change things; search and planning agents only read.
  if ((name === "Agent" || name === "Task") && !READ_ONLY_AGENTS.has(String(input.subagent_type ?? ""))) return { type: "SubAgentActivity", id, agent_type: String(input.subagent_type ?? "general-purpose") };
  return null;
}

const EVIDENCE = ["CommandExecution", "FileChange", "McpToolCall", "ImageView"];

/**
 * A session plus its subagents. Their commands, edits, browser steps, and
 * image views count as the session's evidence, tagged subagent.
 * Codex: the parent's log records only that a subagent was active
 * (agent_thread_id); each subagent writes its own rollout beside the parent's.
 * Claude Code: subagents write <session>/subagents/agent-*.jsonl.
 */
export function readSession(path, { from = 0, since = 0 } = {}) {
  const session = readRollout(path, { from });
  if (!path) return session;
  if (session.meta?.harness === "Claude Code") return withClaudeSubagents(path, session, since);
  const threads = [...new Set(session.items.filter(({ it }) => it.type === "SubAgentActivity" && it.agent_thread_id).map(({ it }) => it.agent_thread_id))];
  if (!threads.length) return session;
  const files = subagentFiles(path, threads);
  const extra = [];
  for (const file of files) {
    for (const item of readCompletedItems(file)) {
      if (EVIDENCE.includes(item.it.type) && (!since || item.t >= since)) extra.push({ ...item, subagent: true });
    }
  }
  const items = [...session.items, ...extra].sort((a, b) => a.t - b.t);
  return { ...session, items, subagents: files.length };
}

function withClaudeSubagents(path, session, since = 0) {
  const dir = join(dirname(path), basename(path, ".jsonl"), "subagents");
  // Subagents that ran before this turn cannot hold its evidence.
  const files = safeList(dir).filter((name) => name.endsWith(".jsonl")).map((name) => join(dir, name)).filter((file) => !since || fileMtime(file) >= since);
  if (!files.length) return session;
  const extra = files.flatMap((file) => readClaudeTranscript(readJsonl(file, { keep: USEFUL }), { sidechain: true }).items.filter(({ t, it }) => EVIDENCE.includes(it.type) && (!since || t >= since)).map((item) => ({ ...item, subagent: true })));
  const items = [...session.items, ...extra].sort((a, b) => a.t - b.t);
  return { ...session, items, subagents: files.length };
}

/** Rollouts for these thread ids, in the parent's day folder and any later day folders. */
function subagentFiles(parentPath, threads) {
  const day = dirname(parentPath);
  const month = dirname(day);
  const year = dirname(month);
  const dirs = [];
  for (const m of safeList(year).filter((m) => m >= basename(month))) {
    for (const d of safeList(join(year, m))) if (join(year, m, d) >= day) dirs.push(join(year, m, d));
  }
  const want = new Set(threads);
  const out = [];
  for (const dir of dirs) {
    for (const name of safeList(dir)) {
      const id = name.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/)?.[1];
      if (id && want.has(id)) out.push(join(dir, name));
    }
  }
  return out;
}

function safeList(dir) {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
}

/** Only the completed-item rows: subagent logs run to tens of megabytes, and most rows are not items. */
function readCompletedItems(file) {
  try {
    return readJsonl(file, { keep: (line) => line.includes('"item_completed"') })
      .filter((r) => r.type === "event_msg" && r.payload?.type === "item_completed" && r.payload.item && applied(r.payload.item))
      .map((r) => ({ at: r.timestamp, t: Date.parse(r.timestamp), it: r.payload.item }));
  } catch {
    return [];
  }
}

function fileMtime(file) {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

/** The shell text of a command item. */
export const commandText = (it) => (Array.isArray(it.command) ? it.command[it.command.length - 1] : String(it.command ?? ""));
