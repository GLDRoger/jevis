import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// A private home and scripted Jev: no network, and the real ~/.claude and ~/.codex are never read.
process.env.JEVIS_HOME = mkdtempSync(join(tmpdir(), "jevis-doctor-home-"));
for (const k of ["JEVIS_WIKI", "JEVIS_MODE", "JEVIS_DISABLE", "JEVIS_JEV_URL", "JEVIS_JEV", "JEVIS_CRITIC"]) delete process.env[k];
const { plan } = await import("../bin/install.mjs");
const { activityChecks, doctor, formatDoctor, hookCheck, jevChecks, privacyCheck, settingsChecks, wikiChecks } = await import("../src/doctor.mjs");
const { setJevTransport } = await import("../src/jev.mjs");

const CLI = fileURLToPath(new URL("../bin/jevis.mjs", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "jevis-doctor-"));
const settings = (name, config) => {
  const file = join(dir, name);
  writeFileSync(file, typeof config === "string" ? config : JSON.stringify(config));
  return file;
};

test("doctor: hooks are ok when every event runs an existing node and this checkout", () => {
  const good = plan({}, "claude", { node: process.execPath, cli: CLI }).config;
  assert.equal(hookCheck("claude", settings("good.json", good), { cli: CLI }).status, "ok");
  assert.equal(hookCheck("codex", settings("codex.json", plan({}, "codex", { node: process.execPath, cli: CLI }).config), { cli: CLI }).status, "ok");

  const noStop = structuredClone(good);
  delete noStop.hooks.Stop;
  const r = hookCheck("claude", settings("nostop.json", noStop), { cli: CLI });
  assert.equal(r.status, "fail");
  assert.match(r.detail, /no hook for Stop/);
  assert.match(r.fix, /install\.mjs --harness claude/);

  const moved = plan({}, "claude", { node: process.execPath, cli: "/gone/jevis/bin/jevis.mjs" }).config;
  assert.match(hookCheck("claude", settings("moved.json", moved), { cli: CLI }).detail, /does not exist \(the checkout moved/);

  const old = structuredClone(good);
  for (const groups of Object.values(old.hooks)) for (const g of groups) for (const h of g.hooks) h.command = `JEVIS_MODE=shadow ${h.command}`;
  const w = hookCheck("claude", settings("old.json", old), { cli: CLI });
  assert.equal(w.status, "warn");
  assert.match(w.detail, /settings on the command \(JEVIS_MODE\)/);

  assert.equal(hookCheck("claude", settings("broken.json", "{ nope"), { cli: CLI }).status, "fail");
  assert.equal(hookCheck("claude", settings("none.json", { hooks: {} }), { cli: CLI }).status, "warn");
  assert.equal(hookCheck("claude", join(dir, "missing.json"), { cli: CLI }).status, "warn", "the harness folder exists, the file does not");
  assert.equal(hookCheck("codex", join(dir, "no-harness", "hooks.json"), { cli: CLI }).status, "skip");
});

test("doctor: a broken settings file fails, shadow or disabled modes are named, and secrets stay masked", () => {
  writeFileSync(join(process.env.JEVIS_HOME, "config.json"), "{ nope");
  assert.ok(settingsChecks({}).some((c) => c.status === "fail" && /not valid JSON/.test(c.detail)));
  writeFileSync(join(process.env.JEVIS_HOME, "config.json"), "{}");
  assert.ok(settingsChecks({ JEVIS_DISABLE: "1" }).some((c) => c.name === "mode" && c.status === "warn"));
  assert.ok(settingsChecks({ JEVIS_MODE: "shadow" }).some((c) => c.name === "mode" && /shadow/.test(c.detail)));
  assert.ok(!JSON.stringify(settingsChecks({ JEVIS_JEV_URL: "https://example.test/v1/systemone?sig=topsecret" })).includes("topsecret"), "a signed URL's signature is masked");
});

test("doctor: the decision model needs a key for TypeSafe, and a live answer", async () => {
  const noKey = await jevChecks({ env: {} });
  assert.equal(noKey[0].status, "fail");
  assert.match(noKey[0].detail, /no API key/);
  setJevTransport(async (body) => ({ answers: { doctor: { type: "noul", noul: 0.9 } }, questions: body.questions }));
  const live = await jevChecks({ env: { TYPESAFE_API_KEY: "sk-test" } });
  assert.equal(live.at(-1).status, "ok");
  assert.ok(!JSON.stringify(live).includes("sk-test"), "the key itself is never shown");
  setJevTransport(async () => {
    throw new Error("HTTP 401: bad key");
  });
  assert.match((await jevChecks({ env: { TYPESAFE_API_KEY: "sk-test" } })).at(-1).detail, /did not answer: HTTP 401/);
  assert.equal((await jevChecks({ env: { TYPESAFE_API_KEY: "sk-test" }, offline: true })).at(-1).status, "info");
});

test("doctor: loose permissions, broken hooks, and failing decisions in the log are warned about", () => {
  const home = mkdtempSync(join(tmpdir(), "jevis-doctor-priv-"));
  mkdirSync(join(home, "backups"));
  if (process.platform !== "win32") {
    chmodSync(join(home, "backups"), 0o755);
    chmodSync(home, 0o700);
    assert.equal(privacyCheck(home).status, "warn");
    chmodSync(join(home, "backups"), 0o700);
    assert.equal(privacyCheck(home).status, "ok");
  } else {
    assert.equal(privacyCheck(home).status, "info");
    assert.match(privacyCheck(home).detail, /permissions are not checked on Windows/);
  }

  const now = Date.parse("2026-09-29T12:00:00Z");
  const log = join(home, "log.jsonl");
  const row = (min, r) => JSON.stringify({ at: new Date(now - min * 60_000).toISOString(), ...r });
  writeFileSync(log, [row(60 * 30, { event: "prompt", harness: "Codex" }), row(1, { event: "hook-error", hook: "tool", error: "TypeError: x is undefined\n at y" }), ...Array.from({ length: 8 }, (_, i) => row(2, { event: "tool", harness: "Claude Code", error: i < 3 ? "timeout after 1500 ms" : undefined }))].join("\n") + "\n");
  const a = activityChecks({ now, file: log });
  assert.match(a.find((c) => c.name === "activity").detail, /^9 events in 24 h; last from Claude Code 2 min ago/);
  assert.match(a.find((c) => c.name === "hook errors").detail, /1 in 24 h .*tool hook: TypeError: x is undefined$/);
  assert.match(a.find((c) => c.name === "decision errors").detail, /3 of 8 decisions failed \(3 timeouts\)/);
  assert.equal(activityChecks({ now: now + 3 * 86_400_000, file: log })[0].status, "warn", "nothing in a day is worth a look");
});

test("doctor: an untrusted project wiki is named, and any failure is a failing run", async () => {
  const repo = mkdtempSync(join(tmpdir(), "jevis-doctor-repo-"));
  mkdirSync(join(repo, ".jevis", "wiki", "team"), { recursive: true });
  writeFileSync(join(repo, ".jevis", "wiki", "team", "x.md"), "---\noff: true\n---\n");
  const w = wikiChecks(repo).find((c) => c.name === "project lessons");
  assert.equal(w.status, "warn");
  assert.match(w.fix, /jevis trust/);
  // Trusted, with a broken lesson: the lessons check fails rather than calling it ok.
  const { projectWiki, setTrust } = await import("../src/wiki.mjs");
  writeFileSync(join(repo, ".jevis", "wiki", "team", "bad.md"), "---\nevent: nonsense\n---\nx\n");
  setTrust(projectWiki(repo));
  const checks0 = wikiChecks(repo);
  assert.equal(checks0.find((c) => c.name === "project lessons").status, "ok");
  assert.match(checks0.find((c) => c.name === "lessons" && c.status === "fail").detail, /broken: team\/bad/);
  assert.ok(wikiChecks(repo, { JEVIS_WIKI: "wiki" }).some((c) => /not absolute are ignored: wiki/.test(c.detail)));

  setJevTransport(async () => ({ answers: { doctor: { type: "noul", noul: 0.5 } } }));
  const checks = await doctor({ targets: { claude: join(dir, "no-claude", "settings.json") }, cwd: repo, env: { TYPESAFE_API_KEY: "k" }, tools: { chrome: true, cli: true, ffmpeg: true } });
  assert.ok(checks.some((c) => c.name === "hooks" && c.status === "fail"), "installed nowhere fails");
  assert.match(formatDoctor(checks), /FAIL {2}hooks: Jevis is installed in no harness\n {8}fix: node bin\/install\.mjs/);
});
