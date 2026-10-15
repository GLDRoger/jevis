import { readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { sessionTurns } from "../../src/replay.mjs";
import { read, write, clean, rank, sanitize } from "./build.mjs";
import { eachJsonl } from "../../src/transcript.mjs";
const files = [];
const walk = (p) => {
  try {
    for (const e of readdirSync(p, { withFileTypes: true })) {
      const f = join(p, e.name);
      if (e.isDirectory() && e.name !== "subagents") walk(f);
      else if (e.name.endsWith(".jsonl")) files.push(f);
    }
  } catch {}
};
walk(join(homedir(), ".codex/sessions"));
walk(join(homedir(), ".claude/projects"));
const stops = read("stop-candidates.jsonl");
const subs = [];
const sessions = new Map();
let enriched = 0;
for (const id of new Set(stops.map((r) => r.sessionId))) {
  const path = files.find((f) => basename(f).includes(id));
  if (!path || statSync(path).size > 200 * 1024 * 1024) continue;
  try {
    const s = sessionTurns(path);
    sessions.set(id, s);
    for (const r of stops.filter((r) => r.sessionId === id)) {
      const next = s.turns.find((t) => t.at > Date.parse(r.at));
      if (next) {
        r.next = clean(next.request);
        r.source += " + transcript next user";
        enriched++;
      }
    }
  } catch {}
}
// A bounded real transcript view for audit of note relevance and subsequent delegation.
const fire = [];
eachJsonl(join(homedir(), ".jevis/log.jsonl"), (r) => {
  if (r.event === "prompt" && r.fired?.some((f) => (typeof f === "string" ? f : f.id) === "workflow/subagent-cost")) fire.push(r);
});
for (const r of fire.sort((a, b) => rank(a.sessionId + a.at).localeCompare(rank(b.sessionId + b.at))).slice(0, 30)) {
  let s = sessions.get(r.sessionId);
  const p = files.find((f) => basename(f).includes(r.sessionId));
  if (!s && p && statSync(p).size < 200 * 1024 * 1024) {
    try {
      s = sessionTurns(p);
    } catch {}
  }
  const t = s?.turns.findLast((t) => t.at <= Date.parse(r.at) + 3000);
  subs.push(
    sanitize({
      id: r.sessionId + ":" + r.at,
      sessionId: r.sessionId,
      at: r.at,
      request: t?.request ?? r.request,
      items: t?.items.filter((x) => ["McpToolCall", "AgentMessage"].includes(x.it.type)).slice(0, 5),
      delegations: t?.items
        .filter((x) => JSON.stringify(x.it).match(/spawn_agent|delegate_task|agent_spawn|subagent_type|claude -p|codex exec/))
        .map((x) => ({ type: x.it.type, text: JSON.stringify(x.it).slice(0, 250) })),
      historicalActed: r.acted ?? [],
      transcript: !!t,
    }),
  );
}
write("stop-candidates.jsonl", stops);
write("subagent-audit.jsonl", subs);
console.log({ enriched, stops: stops.length, subagent: subs.length, sessionReads: sessions.size });
