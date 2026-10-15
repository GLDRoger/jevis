import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { errorClass, errorMessage, FAILURE_WINDOW, outageLine, recordHealth } from "../src/health.mjs";
import { askJev, setJevTransport } from "../src/jev.mjs";
import { onPrompt, onSession, onStop } from "../src/hooks.mjs";
import { activityChecks } from "../src/doctor.mjs";
import { loadSession, log, saveSession } from "../src/state.mjs";

process.env.JEVIS_HOME = mkdtempSync(join(tmpdir(), "jevis-health-"));
for (const key of ["JEVIS_MODE", "JEVIS_JEV", "JEVIS_SCOPE", "JEVIS_DISABLE", "JEVIS_WIKI"]) delete process.env[key];
process.env.JEVIS_CRITIC = "off";
const question = { probe: { type: "noul", instructions: "Is this a probe?" } };
const good = async (body) => ({ answers: Object.fromEntries(Object.keys(body.questions).map((id) => [id, { noul: 0.05 }])) });

test("outages: nested messages, codes, detail and bounded objects never stringify badly", () => {
  assert.equal(errorMessage({ error: { message: "Credits exhausted", code: "billing" } }), "Credits exhausted");
  assert.equal(errorMessage({ error: { code: "out_of_credits" } }), "out_of_credits");
  assert.equal(errorMessage({ detail: { reason: "billing exhausted" } }), '{"reason":"billing exhausted"}');
  assert.equal(errorMessage({ strange: "object" }), '{"strange":"object"}');
  assert.equal(errorMessage({ detail: "ordinary words ".repeat(90) }).length, 200);
  assert.equal(errorMessage({ error: { message: "API_KEY=not-a-real-value" } }).includes("not-a-real-value"), false);
  assert.equal(errorMessage(new Error("HTTP 402: [object Object]")).includes("[object Object]"), false);
  for (const [error, kind] of [["HTTP 401", "auth/billing"], ["HTTP 402", "auth/billing"], ["HTTP 403", "auth/billing"], ["HTTP 429", "rate-limit"], ["HTTP 503", "server"], ["timeout after 1500 ms", "timeout"], ["fetch failed", "network"], ["ENOTFOUND", "network"]]) assert.equal(errorClass(error), kind);
});

test("outages: real HTTP transport preserves errors and fails open by class", async (t) => {
  const server = createServer((req, res) => {
    req.resume();
    const status = Number(req.url.slice(1));
    res.writeHead(status, { "Content-Type": status === 502 ? "text/plain" : "application/json" });
    res.end(status === 502 ? "upstream temporarily unavailable" : JSON.stringify({ error: { code: "billing_exhausted" } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  setJevTransport(null);
  const url = process.env.JEVIS_JEV_URL;
  t.after(() => url === undefined ? delete process.env.JEVIS_JEV_URL : process.env.JEVIS_JEV_URL = url);
  for (const [status, kind] of [[401, "auth/billing"], [402, "auth/billing"], [403, "auth/billing"], [429, "rate-limit"], [500, "server"], [502, "server"]]) {
    process.env.JEVIS_JEV_URL = `http://127.0.0.1:${server.address().port}/${status}`;
    const result = await askJev({ state: {}, questions: question, event: "tool", record: false });
    assert.equal(result.answers, null);
    assert.equal(result.error, `HTTP ${status}: ${status === 502 ? "upstream temporarily unavailable" : "billing_exhausted"}`);
    assert.equal(result.errorClass, kind);
  }
  for (const [error, kind] of [[Object.assign(new Error("slow"), { name: "TimeoutError" }), "timeout"], [new TypeError("fetch failed"), "network"]]) {
    setJevTransport(async () => { throw error; });
    const result = await askJev({ state: {}, questions: question, event: "tool", record: false });
    assert.equal(result.answers, null);
    assert.equal(result.errorClass, kind);
  }
  setJevTransport(good);
});

test("outages: client tracks failures/recovery even with call recording off", async () => {
  recordHealth(null);
  process.env.JEVIS_RECORD = "off";
  try {
    setJevTransport(async () => { throw new Error("HTTP 402: billing"); });
    for (let i = 0; i < 3; i++) await askJev({ state: {}, questions: question, event: "tool" });
    assert.match(outageLine(), /HTTP 402 billing/);
    setJevTransport(good);
    await askJev({ state: {}, questions: question, event: "tool" });
    assert.equal(outageLine(), null);
  } finally { delete process.env.JEVIS_RECORD; }
});

test("outages: a short once-per-session note, never in shadow/off; recovers and expires", async () => {
  const now = Date.now();
  for (let i = 0; i < 3; i++) recordHealth("HTTP 402: billing", { now: now - 3000 + i });
  const start = { session_id: "warning", hook_event_name: "SessionStart", source: "startup" };
  assert.match(onSession(start).hookSpecificOutput.additionalContext, /Jev unavailable since \d\d:\d\d UTC \(HTTP 402 billing\).*passing everything through/);
  assert.equal(onSession(start), null, "startup before the first prompt must not reset the warning flag");
  setJevTransport(async () => { throw new Error("HTTP 402: billing"); });
  assert.equal(await onPrompt({ ...start, prompt: "hello" }), null, "not twice in a session");
  assert.match((await onPrompt({ session_id: "prompt-only", prompt: "hello" })).hookSpecificOutput.additionalContext, /Jevis: Jev unavailable/);
  assert.equal(await onPrompt({ session_id: "prompt-only", prompt: "hello again" }), null);
  process.env.JEVIS_MODE = "shadow";
  assert.equal(onSession({ ...start, session_id: "shadow-warning" }), null);
  assert.equal(loadSession("shadow-warning").outageShown, undefined);
  delete process.env.JEVIS_MODE;
  process.env.JEVIS_JEV = "off";
  assert.equal(outageLine(), null);
  delete process.env.JEVIS_JEV;
  recordHealth(null, { now });
  assert.equal(outageLine(), null);
  for (let i = 0; i < 3; i++) recordHealth("fetch failed", { now: now - FAILURE_WINDOW - 10 + i });
  assert.equal(outageLine({ now }), null);
  recordHealth("fetch failed", { now });
  assert.equal(outageLine({ now }), null, "a stale streak starts over");
  setJevTransport(good);
});

test("outages: log-derived doctor streaks count classes and distinguish recovery/skips", () => {
  const now = Date.parse("2026-10-13T12:00:00Z");
  const file = join(process.env.JEVIS_HOME, "doctor-log.jsonl");
  const rows = [
    { error: "HTTP 402: [object Object]", ms: 1 },
    { error: "HTTP 401: unauthorized", ms: 1 },
    { skipped: "no entries" },
    { ms: 1, pool: 1 },
    { error: "HTTP 429: busy", ms: 1 },
    { error: "HTTP 500: server", ms: 1 },
    { error: "timeout after 1500 ms", ms: 1 },
    { error: "fetch failed", ms: 1 },
  ].map((r, i) => ({ at: new Date(now - 10_000 + i * 1000).toISOString(), event: "tool", ...r }));
  writeFileSync(file, rows.map(JSON.stringify).join("\n") + "\n");
  const report = activityChecks({ now, file }).find((r) => r.name === "recent Jev failures");
  assert.equal(report.status, "warn");
  assert.match(report.detail, /6 in .*auth\/billing 2, rate-limit 1, server 1, timeout 1, network 1/);
  assert.match(report.detail, /failure streaks: 2 calls, .*; 4 calls,/);
});

test("outages: ENOSPC/EACCES log, health, and session writes never throw or block", async () => {
  const home = process.env.JEVIS_HOME;
  const broken = join(home, "not-a-directory");
  writeFileSync(broken, "file");
  process.env.JEVIS_HOME = broken;
  try {
    assert.doesNotThrow(() => log({ event: "probe" }));
    assert.doesNotThrow(() => recordHealth("HTTP 402"));
    assert.equal(saveSession("s", {}), false);
    assert.equal(onSession({ session_id: "s" }), null);
    assert.equal(await onPrompt({ session_id: "s", prompt: "hello" }), null);
  } finally { process.env.JEVIS_HOME = home; }
  assert.equal(saveSession("disk", {}, { rename: () => { throw Object.assign(new Error("full"), { code: "ENOSPC" }); } }), false);
  assert.equal(saveSession("disk", {}, { rename: () => { throw Object.assign(new Error("denied"), { code: "EACCES" }); } }), false);
  const wiki = join(home, "blocking-wiki");
  mkdirSync(wiki);
  writeFileSync(join(wiki, "block.md"), "---\nevent: stop\naction: block\nask: Is this done?\ntitle: Check\nsource: test\n---\nCheck it.\n");
  process.env.JEVIS_WIKI = wiki;
  setJevTransport(async (body) => ({ answers: Object.fromEntries(Object.keys(body.questions).map((id) => [id, { noul: 0.95 }])) }));
  const sessionPath = join(home, "sessions", "unsavable.json");
  mkdirSync(sessionPath);
  assert.equal(await onStop({ session_id: "unsavable", last_assistant_message: "Done" }), null, "unsaved counters cannot hold a turn");
  delete process.env.JEVIS_WIKI;
  setJevTransport(good);
  assert.equal(readFileSync(join(home, "jev-health.json"), "utf8").includes("API_KEY"), false);
});
