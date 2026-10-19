import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { commandText, eachJsonl } from "./transcript.mjs";

/** Offline transcript lookup. Raw commands stay in memory, never in the
 * report. A session filename, nearby execution timestamp AND matching logged
 * prefix are required; ambiguous distinct commands remain unauditable.
 */
export function recoverToolInputs(rows, { roots = [join(homedir(), ".claude/projects"), join(homedir(), ".codex/sessions")], windowMs = 120_000 } = {}) {
  const sessions = new Map();
  for (const row of rows) {
    if (!row.sessionId || typeof row.input !== "string" || !row.input.endsWith("…") || !Number.isFinite(Date.parse(row.at))) continue;
    if (!sessions.has(row.sessionId)) sessions.set(row.sessionId, []);
    sessions.get(row.sessionId).push(row);
  }
  const files = new Map();
  const ids = [...sessions.keys()];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const file = join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        const id = ids.find((id) => entry.name === `${id}.jsonl` || entry.name.endsWith(`-${id}.jsonl`));
        if (!id) continue;
        if (!files.has(id)) files.set(id, []);
        files.get(id).push(file);
      }
    }
  };
  if (ids.length) for (const root of roots) walk(root);
  const recovered = new Map();
  for (const [id, sessionRows] of sessions) {
    const commands = [];
    const add = (at, input) => {
      const t = typeof at === "number" ? at : Date.parse(at);
      if (Number.isFinite(t) && typeof input === "string" && input && !input.endsWith("…")) commands.push({ t, input });
    };
    for (const file of files.get(id) ?? []) {
      try {
        eachJsonl(file, (row) => {
          const payload = row.payload;
          if (row.type === "assistant" && Array.isArray(row.message?.content)) {
            for (const block of row.message.content) {
              if (block.type === "tool_use" && block.name === "Bash") add(row.timestamp, block.input?.command);
            }
          } else if (row.type === "event_msg" && payload?.type === "item_completed" && payload.item?.type === "CommandExecution") {
            add(payload.started_at_ms ?? row.timestamp, commandText(payload.item));
          } else if (row.type === "response_item" && payload?.type === "function_call" && /(?:^|__|\.)(?:exec_command|shell_command|shell|Bash|bash)$/.test(payload.name ?? "")) {
            let args;
            try { args = typeof payload.arguments === "string" ? JSON.parse(payload.arguments) : payload.arguments; } catch { return; }
            const input = args?.cmd ?? args?.command;
            add(row.timestamp, Array.isArray(input) ? input.at(-1) : input);
          }
        }, { keep: (line) => /"(?:tool_use|item_completed|function_call)"/.test(line) });
      } catch { /* Missing/unreadable transcripts are explicitly unauditable. */ }
    }
    commands.sort((a, b) => a.t - b.t);
    for (const row of sessionRows) {
      const t = Date.parse(row.at), prefix = row.input.slice(0, -1);
      if (!prefix) continue;
      let lo = 0, hi = commands.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (commands[mid].t < t - windowMs) lo = mid + 1; else hi = mid; }
      const matches = new Set();
      for (let i = lo; i < commands.length && commands[i].t <= t + windowMs; i++) {
        const input = commands[i].input;
        if (input.startsWith(prefix)) matches.add(input);
      }
      if (matches.size === 1) recovered.set(row, matches.values().next().value);
    }
  }
  return recovered;
}
