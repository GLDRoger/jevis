import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

process.env.JEVIS_HOME = mkdtempSync(join(tmpdir(), "jevis-config-home-"));
const { applyConfig, readConfig, settingSources, writeConfig } = await import("../src/config.mjs");
const CLI = fileURLToPath(new URL("../bin/jevis.mjs", import.meta.url));

test("settings: valid values are read as the environment spells them; problems are named, never thrown", () => {
  const file = join(process.env.JEVIS_HOME, "config.json");
  writeFileSync(file, JSON.stringify({ JEVIS_MODE: "shadow", JEVIS_ENABLE: ["safety", "slop/marquee"], JEVIS_SCOPE: ["/a", "/b"], JEVIS_DISABLE: false, JEVIS_RECORD: false, JEVIS_TIMEOUT_MS: 2500, JEVIS_CRITIC: "gemini", JEVIS_HOME: "/x", TYPESAFE_API_KEY: "k", NOPE: 1 }));
  const c = readConfig(file);
  assert.deepEqual(c.values, { JEVIS_MODE: "shadow", JEVIS_ENABLE: "safety,slop/marquee", JEVIS_SCOPE: ["/a", "/b"].join(delimiter), JEVIS_RECORD: "off", JEVIS_TIMEOUT_MS: "2500" });
  assert.equal(c.errors.length, 4);
  assert.ok(c.errors.some((e) => /JEVIS_CRITIC: "gemini" is not valid/.test(e)));
  assert.ok(c.errors.some((e) => /API key belongs in ~\/\.jevis\/secrets/.test(e)), "a key in the settings file is refused");
  assert.ok(c.errors.some((e) => /NOPE is not a setting/.test(e)));
  writeFileSync(file, "{ not json");
  assert.match(readConfig(file).errors[0], /not valid JSON/);
  assert.deepEqual(readConfig(join(process.env.JEVIS_HOME, "missing.json")), { file: join(process.env.JEVIS_HOME, "missing.json"), exists: false, raw: {}, values: {}, errors: [] });
});

test("settings: the environment wins over the file, and each value's source is known", () => {
  writeFileSync(join(process.env.JEVIS_HOME, "config.json"), JSON.stringify({ JEVIS_MODE: "shadow", JEVIS_CRITIC: "codex" }));
  const env = { JEVIS_CRITIC: "off" };
  applyConfig(env);
  assert.deepEqual(env, { JEVIS_CRITIC: "off", JEVIS_MODE: "shadow" });
  const sources = Object.fromEntries(settingSources(env).map((s) => [s.key, s.source]));
  assert.equal(sources.JEVIS_MODE, "file");
  assert.equal(sources.JEVIS_CRITIC, "environment");
  assert.equal(sources.JEVIS_SCOPE, "default");
});

test("settings: writing keeps other settings, removes a null one, and the file is private", () => {
  const file = join(process.env.JEVIS_HOME, "config.json");
  writeFileSync(file, JSON.stringify({ JEVIS_MODE: "shadow", JEVIS_CRITIC: "codex" }));
  assert.deepEqual(writeConfig({ JEVIS_MODE: null, JEVIS_JEV_URL: "http://127.0.0.1:8000/v1/systemone" }), { JEVIS_CRITIC: "codex", JEVIS_JEV_URL: "http://127.0.0.1:8000/v1/systemone" });
  if (process.platform !== "win32") assert.equal(statSync(file).mode & 0o777, 0o600);
  writeFileSync(file, "[1]");
  assert.throws(() => writeConfig({ JEVIS_MODE: "shadow" }), /fix or remove it first/, "a broken file is never overwritten");
});

test("settings: a hook honors the file, and a broken file leaves Jevis running", () => {
  const home = mkdtempSync(join(tmpdir(), "jevis-config-hook-"));
  const env = { ...process.env, JEVIS_HOME: home, JEVIS_JEV: "off" };
  delete env.JEVIS_DISABLE;
  const prompt = JSON.stringify({ session_id: "s", cwd: tmpdir(), prompt: "make a page" });
  const rows = () => (existsSync(join(home, "log.jsonl")) ? readFileSync(join(home, "log.jsonl"), "utf8").trim().split("\n").filter(Boolean).length : 0);
  writeFileSync(join(home, "config.json"), JSON.stringify({ JEVIS_DISABLE: true }));
  execFileSync(process.execPath, [CLI, "hook", "prompt"], { env, input: prompt });
  assert.equal(rows(), 0, "JEVIS_DISABLE from the file turned the hook off");
  writeFileSync(join(home, "config.json"), "{ broken");
  execFileSync(process.execPath, [CLI, "hook", "prompt"], { env, input: prompt });
  assert.equal(rows(), 1, "a broken file is ignored and the hook runs as usual");
});
