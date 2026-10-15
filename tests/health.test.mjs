import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { errorClass, errorMessage, FAILURE_WINDOW, outageLine, recordHealth } from "../src/health.mjs";
import { askJev, chunkSize, decider, jevAvailable, lunaKey, lunaTransport, setJevTransport, setLunaUrl } from "../src/jev.mjs";
import { onPrompt, onSession, onStop } from "../src/hooks.mjs";
import { activityChecks } from "../src/doctor.mjs";
import { loadSession, log, saveSession } from "../src/state.mjs";

process.env.JEVIS_HOME = mkdtempSync(join(tmpdir(), "jevis-health-"));
for (const key of ["JEVIS_MODE", "JEVIS_JEV", "JEVIS_SCOPE", "JEVIS_DISABLE", "JEVIS_WIKI"]) delete process.env[key];
process.env.JEVIS_CRITIC = "off";
const question = { probe: { type: "noul", instructions: "Is this a probe?" } };
const good = async (body) => ({ answers: Object.fromEntries(Object.keys(body.questions).map((id) => [id, { noul: 0.05 }])) });

// New provider tests restore every setting they touch, even on assertion failure.
const providerEnv = (t, values = {}) => {
  const keys = ["JEVIS_DECIDER", "JEVIS_LUNA_MODEL", "JEVIS_LUNA_KEY", "OPENAI_API_KEY", "JEVIS_JEV_MODEL", "JEVIS_JEV_URL", "JEVIS_JEV_CHUNK", "JEVIS_JEV", "JEVIS_RECORD", "JEVIS_MODE", "JEVIS_HOME"];
  const before = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const [key, value] of Object.entries(before)) value === undefined ? delete process.env[key] : process.env[key] = value;
    setJevTransport(good);
    setLunaUrl(null);
  });
  for (const key of keys) if (key !== "JEVIS_HOME") delete process.env[key];
  Object.assign(process.env, values);
};

test("deciders: TypeSafe defaults to Jev 1.14 and honors its model override", async (t) => {
  providerEnv(t, { JEVIS_HOME: mkdtempSync(join(tmpdir(), "jevis-jev-model-")) });
  assert.equal(decider(), "jev");
  const models = [];
  setJevTransport(async (body) => { models.push(body.model); return good(body); });
  await askJev({ state: {}, questions: question, event: "tool" });
  process.env.JEVIS_JEV_MODEL = "custom-jev";
  await askJev({ state: {}, questions: question, event: "tool" });
  assert.deepEqual(models, ["jev-1.14.0", "custom-jev"]);
  const rows = readFileSync(join(process.env.JEVIS_HOME, "jev", "calls.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(rows.map((r) => [r.decider, r.deciderModel]), [["jev", "jev-1.14.0"], ["jev", "custom-jev"]]);
  process.env.JEVIS_JEV_URL = "http://127.0.0.1:8000/v1/systemone";
  delete process.env.JEVIS_JEV_MODEL;
  await askJev({ state: {}, questions: question, record: false });
  assert.equal(models.at(-1), undefined, "self-hosted Jev still receives no default model");
});

test("deciders: Luna HTTP translation, refusals, chunking, usage, and recording", async (t) => {
  providerEnv(t, { JEVIS_DECIDER: "luna", JEVIS_LUNA_KEY: " fake-luna-key ", JEVIS_HOME: mkdtempSync(join(tmpdir(), "jevis-luna-")) });
  const requests = [];
  let status = 200;
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const part of req) raw += part;
    const body = JSON.parse(raw);
    requests.push({ body, method: req.method, auth: req.headers.authorization });
    res.setHeader("Content-Type", "application/json");
    if (status !== 200) {
      res.writeHead(status);
      return res.end(JSON.stringify({ error: { message: "Bad OpenAI key", type: "invalid_request_error" } }));
    }
    res.end(JSON.stringify({ model: body.model, answers: body.questions.map((q) => q.name === "refusal" ? { type: "refusal", name: q.name } : q.name === "missing" ? { type: "predicate", name: q.name } : { type: "predicate", name: q.name, probability: 0.8 }), usage: { input_tokens: 12, output_tokens: 2 } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  setLunaUrl(`http://127.0.0.1:${server.address().port}/v1/decisions`);
  setJevTransport(null);
  process.env.JEVIS_JEV_URL = "http://127.0.0.1:1/ignored";
  process.env.JEVIS_JEV_MODEL = "ignored-jev";
  const qs = {
    "slop/emoji#unless": { type: "noul", instructions: "Does this qualify?", criteria: { true: "it qualifies", false: "it does not" } },
    "axis:foo": { type: "noul", instructions: "Is this a probe?" },
    refusal: question.probe, missing: question.probe,
  };
  const r = await askJev({ state: { request: "probe", token: "sk-not-a-real-secret" }, questions: qs, model: "claude-test", event: "tool" });
  assert.equal(r.error, null);
  assert.deepEqual(r.answers, { "slop/emoji#unless": { noul: 0.8 }, "axis:foo": { noul: 0.8 } });
  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.equal(request.method, "POST");
  assert.equal(request.auth, "Bearer fake-luna-key");
  assert.equal(request.body.model, "gpt-6-luna");
  assert.equal(typeof request.body.input, "string");
  assert.deepEqual(JSON.parse(request.body.input), { request: "probe", token: "[redacted]" });
  assert.deepEqual(request.body.questions, [
    { type: "predicate", name: "slop/emoji#unless", instructions: "Does this qualify? Yes means: it qualifies. No means: it does not." },
    { type: "predicate", name: "axis:foo", instructions: "Is this a probe?" },
    { type: "predicate", name: "refusal", instructions: question.probe.instructions },
    { type: "predicate", name: "missing", instructions: question.probe.instructions },
  ]);
  const calls = () => readFileSync(join(process.env.JEVIS_HOME, "jev", "calls.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(calls()[0].decider, "luna");
  assert.equal(calls()[0].deciderModel, "gpt-6-luna");
  assert.equal(calls()[0].model, "claude-test", "the agent-model field retains its meaning");
  assert.deepEqual(calls()[0].usage, { input_tokens: 12, output_tokens: 2 });

  process.env.JEVIS_LUNA_MODEL = "custom-luna";
  await askJev({ state: {}, questions: question, event: "tool" });
  assert.equal(requests[1].body.model, "custom-luna");
  assert.equal(calls()[1].deciderModel, "custom-luna");
  requests.length = 0;
  const many = Object.fromEntries(Array.from({ length: 450 }, (_, i) => [`q${i}`, question.probe]));
  assert.equal(chunkSize(), 200);
  const chunked = await askJev({ state: {}, questions: many, event: "tool" });
  assert.equal(Object.keys(chunked.answers).length, 450);
  assert.deepEqual(requests.map((r) => r.body.questions.length).sort((a, b) => a - b), [50, 200, 200]);
  assert.deepEqual(calls().at(-1).usage, { input_tokens: 36, output_tokens: 6 });
  process.env.JEVIS_JEV_CHUNK = "150";
  assert.equal(chunkSize(), 150);
  status = 401;
  const failed = await askJev({ state: {}, questions: question, record: false });
  assert.equal(failed.answers, null);
  assert.equal(failed.error, "HTTP 401: Bad OpenAI key");
  assert.equal(failed.errorClass, "auth/billing");
});

test("deciders: Luna hedges a stalled HTTP request and aborts the loser", async (t) => {
  providerEnv(t, { JEVIS_DECIDER: "luna", JEVIS_LUNA_KEY: "fake-key" });
  let requests = 0;
  let closed;
  const loserClosed = new Promise((resolve) => { closed = resolve; });
  const server = createServer((req, res) => {
    req.resume();
    requests += 1;
    if (requests === 1) return void res.on("close", closed);
    res.end(JSON.stringify({ answers: [{ type: "predicate", name: "probe", probability: 1 }] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  setLunaUrl(`http://127.0.0.1:${server.address().port}/v1/decisions`);
  setJevTransport(null);
  const r = await askJev({ state: {}, questions: question, timeoutMs: 2000, record: false });
  assert.equal(r.error, null);
  assert.equal(r.answers.probe.noul, 1);
  assert.ok(requests >= 2 && requests <= 3);
  await loserClosed;
});

test("deciders: unsupported Luna questions throw and askJev fails open", async (t) => {
  providerEnv(t, { JEVIS_DECIDER: "luna", JEVIS_LUNA_KEY: "fake-key" });
  setJevTransport(null);
  const body = { state: {}, questions: { bad: { type: "choice", instructions: "Pick one" } } };
  await assert.rejects(lunaTransport(body, 100), /Luna supports only noul questions: bad has type choice/);
  const r = await askJev({ ...body, record: false });
  assert.equal(r.answers, null);
  assert.match(r.error, /only noul/);
});

test("deciders: Luna key precedence, trimming, and availability", (t) => {
  providerEnv(t, { JEVIS_DECIDER: "luna", JEVIS_HOME: mkdtempSync(join(tmpdir(), "jevis-luna-key-")) });
  setJevTransport(null);
  assert.equal(jevAvailable(), false);
  mkdirSync(join(process.env.JEVIS_HOME, "secrets"));
  const file = join(process.env.JEVIS_HOME, "secrets", "openai_api_key");
  writeFileSync(file, " \n ");
  assert.equal(jevAvailable(), false);
  writeFileSync(file, " file-key\n");
  assert.deepEqual(lunaKey(), { key: "file-key", source: file });
  assert.equal(jevAvailable(), true);
  process.env.OPENAI_API_KEY = " openai-env ";
  assert.deepEqual(lunaKey(), { key: "openai-env", source: "OPENAI_API_KEY" });
  process.env.JEVIS_LUNA_KEY = " luna-env ";
  assert.deepEqual(lunaKey(), { key: "luna-env", source: "JEVIS_LUNA_KEY" });
  process.env.JEVIS_LUNA_KEY = " ";
  assert.equal(lunaKey().source, "OPENAI_API_KEY");
  process.env.JEVIS_JEV = "off";
  assert.equal(jevAvailable(), false);
});

test("outages: Luna uses its own name with the unchanged outage wording", (t) => {
  providerEnv(t, { JEVIS_DECIDER: "luna" });
  const now = Date.parse("2026-10-15T12:00:00Z");
  for (let i = 0; i < 3; i++) recordHealth("HTTP 401: bad key", { now });
  assert.equal(outageLine({ now }), "Jevis: GPT-6 Luna unavailable since 12:00 UTC (HTTP 401 auth/billing). Hooks are passing everything through.");
  delete process.env.JEVIS_DECIDER;
  assert.equal(outageLine({ now }), "Jevis: Jev unavailable since 12:00 UTC (HTTP 401 auth/billing). Hooks are passing everything through.");
  recordHealth(null);
});

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
