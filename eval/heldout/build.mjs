import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { eachJsonl } from "../../src/transcript.mjs";
import { redact } from "../../src/redact.mjs";
import { loadWiki, WIKI_ROOT } from "../../src/wiki.mjs";

export const ROOT = new URL("./private/", import.meta.url);
export const SEED = "jevis-real-2026-10-13-v1";
export const hash = (x) => createHash("sha256").update(x).digest("hex");
export const rank = (x) => hash(`${SEED}:${x}`);
// Additional PII clipping. These are private even after redaction; no anonymization claim.
export const clean = (s) =>
  redact(String(s ?? ""))
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[email]")
    .replace(/\/(?:Users|home)\/[^/\s]+/g, "/[home]")
    .replace(/https?:\/\/[^\s<>"`)]+/g, "[url]")
    .replace(/\b(?:\+?\d[\d ()-]{8,}\d)\b/g, "[number]")
    .slice(0, 3000);
export const sanitize = (x) =>
  typeof x === "string"
    ? clean(x)
    : Array.isArray(x)
      ? x.map(sanitize)
      : x && typeof x === "object"
        ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, ["id", "sessionId", "at", "version"].includes(k) ? v : sanitize(v)]))
        : x;
export const read = (file, root = ROOT) => readFileSync(new URL(file, root), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
export const write = (file, rows, root = ROOT) => writeFileSync(new URL(file, root), rows.map((x) => JSON.stringify(x)).join("\n") + "\n", { mode: 0o600 });

if (process.argv[1] === new URL(import.meta.url).pathname) {
  if (existsSync(new URL("manifest.json", ROOT))) throw new Error("Frozen splits exist. Never overwrite test data; use a new version.");
  mkdirSync(ROOT, { recursive: true, mode: 0o700 });
  const logs = [];
  eachJsonl(join(homedir(), ".jevis/log.jsonl"), (r) => {
    if (["prompt", "tool", "stop"].includes(r.event)) logs.push(r);
  });
  const groups = new Map();
  for (const r of logs) {
    const k = `${r.sessionId}:${r.event}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  for (const v of groups.values()) v.sort((a, b) => a.at.localeCompare(b.at));
  const matched = new Map();
  eachJsonl(join(homedir(), ".jevis/jev/calls.jsonl"), (r) => {
    const list = groups.get(`${r.sessionId}:${r.event}`);
    if (!list || !r.state) return;
    const end = Date.parse(r.at) + (r.ms || 0);
    let lo = 0,
      hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (Date.parse(list[mid].at) < end - 250) lo = mid + 1;
      else hi = mid;
    }
    const c = list[lo];
    if (c && Math.abs(Date.parse(c.at) - end) < 2500) {
      const key = `${c.sessionId}:${c.event}:${c.at}`;
      const old = matched.get(key);
      if (!old || Math.abs(Date.parse(c.at) - end) < old.delta)
        matched.set(key, { state: r.state, model: r.model, delta: Math.abs(Date.parse(c.at) - end), version: r.version });
    }
  });
  const key = (r) => `${r.sessionId}:${r.event}:${r.at}`;
  const state = (r) => matched.get(key(r))?.state;
  const stops = logs
    .filter((r) => r.event === "stop" && state(r)?.final_message)
    .map((r) => {
      const next = (groups.get(`${r.sessionId}:prompt`) ?? []).find((p) => p.at > r.at);
      if (!next?.request) return null;
      const st = state(r);
      if (
        !/(done|fixed|complete|verified|working|ready|shipped|implemented|passed|built|updated|created|changed|checks|resolved|tested)/i.test(st.final_message)
      )
        return null;
      return sanitize({
        id: key(r),
        sessionId: r.sessionId,
        turn: r.turn,
        at: r.at,
        event: "stop",
        harness: r.harness,
        model: matched.get(key(r))?.model,
        state: st,
        next: next.request,
        source: "hook + Jev call + next real prompt",
        historicalFired: r.fired ?? [],
      });
    })
    .filter(Boolean);
  const correction = (r) =>
    /(not |didn.t|haven.t|still|wrong|broken|missing|doesn.t|don.t|failed|really|actually|you said|why |i asked|i told|finish|do the|verify|check|tested|test it)/i.test(
      r.next,
    );
  const byRank = (xs) => xs.sort((a, b) => rank(a.id).localeCompare(rank(b.id)));
  const picked = [];
  const perSession = new Map();
  for (const r of [...byRank(stops.filter(correction)), ...byRank(stops.filter((r) => !correction(r)))]) {
    const n = perSession.get(r.sessionId) || 0;
    if (n >= 4) continue;
    perSession.set(r.sessionId, n + 1);
    picked.push(r);
    if (picked.length >= 220) break;
  }
  write("stop-candidates.jsonl", picked);
  const fire = logs.filter((r) => r.event === "tool" && r.fired?.length);
  const non = logs.filter((r) => r.event === "tool" && !r.fired?.length);
  const byTool = new Map();
  for (const r of non) {
    if (!byTool.has(r.tool)) byTool.set(r.tool, []);
    byTool.get(r.tool).push(r);
  }
  const random = [];
  for (const v of byTool.values()) random.push(...byRank(v.map((r) => ({ ...r, id: key(r) }))).slice(0, 4));
  const used = new Set(random.map(key));
  random.push(...byRank(non.filter((r) => !used.has(key(r))).map((r) => ({ ...r, id: key(r) }))).slice(0, Math.max(0, 280 - random.length)));
  const toolRows = [...fire, ...random].map((r) =>
    sanitize({
      id: key(r),
      sessionId: r.sessionId,
      turn: r.turn,
      at: r.at,
      event: "tool",
      tool: r.tool,
      harness: r.harness,
      model: matched.get(key(r))?.model,
      state: state(r) ?? {
        request: (groups.get(`${r.sessionId}:prompt`) ?? []).findLast((p) => p.at <= r.at)?.request ?? "",
        input: r.input ?? "",
        tool: r.tool,
        workspace: { git: null, files: [], empty: null },
      },
      fullState: !!state(r),
      historicalFired: r.fired ?? [],
      historicalActed: r.acted ?? [],
      sampling: r.fired?.length ? "all logged fires" : "stratified random nonfire",
    }),
  );
  write("tool-candidates.jsonl", toolRows);
  const promptFile = new URL("../prompts.jsonl", import.meta.url);
  if (existsSync(promptFile)) {
    const prompts = readFileSync(promptFile, "utf8").trim().split("\n").map(JSON.parse);
    write(
      "prompt-candidates.jsonl",
      prompts.map((r, i) =>
        sanitize({
          ...r,
          sessionId: r.sessionId ?? r.session_id ?? r.source?.sessionId ?? `legacy-unknown-${i}`,
          tuned: true,
          tuningStatus: "legacy corpus; no proven independence; tune only",
        }),
      ),
    );
  }
  const wiki = loadWiki([WIKI_ROOT]);
  writeFileSync(new URL("baseline-wiki.json", ROOT), JSON.stringify(wiki), { mode: 0o600 });
  writeFileSync(
    new URL("build-summary.json", ROOT),
    JSON.stringify(
      {
        seed: SEED,
        logs: logs.length,
        matched: matched.size,
        eligibleStops: stops.length,
        stopCandidates: picked.length,
        toolCandidates: toolRows.length,
        loggedFireCalls: fire.length,
        nonfires: random.length,
        toolStrata: byTool.size,
      },
      null,
      2,
    ),
  );
  console.log(readFileSync(new URL("build-summary.json", ROOT), "utf8"));
}
