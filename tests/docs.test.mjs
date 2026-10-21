import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { build } from "../docs/build.mjs";
import { loadNudges, NUDGES_ROOT } from "../src/nudges.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

test("the overview is current and includes every shipped tip exactly once", () => {
  const html = build();
  assert.equal(html, readFileSync(join(root, "docs/index.html"), "utf8"));
  const { nudges, broken } = loadNudges({ roots: [NUDGES_ROOT] });
  assert.deepEqual(broken, []);
  assert.ok(nudges.length > 0, "the shipped catalog must not disappear silently");
  assert.equal((html.match(/<article class="tip">/g) ?? []).length, nudges.length);
  for (const { id } of nudges) {
    assert.equal(html.split(`>${id}.md</a>`).length - 1, 1, id);
  }
  assert.doesNotMatch(html, /<!--(?:LEAD|MOMENTS|TIPS|TIPCOUNT)-->/);
  assert.doesNotMatch(html, /permissionDecision|SCENARIOS/);
});

test("the docs build ignores personal tips, escapes source text, and detects stale output without writing", (t) => {
  const scratch = mkdtempSync(join(tmpdir(), "jevis-docs-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const repo = join(scratch, "repo");
  mkdirSync(repo);
  for (const path of ["docs", "nudges", "src", "README.md"]) cpSync(join(root, path), join(repo, path), { recursive: true });
  const alias = join(scratch, "linked repo");
  symlinkSync(repo, alias, process.platform === "win32" ? "junction" : "dir");
  const home = join(scratch, "home");
  const custom = join(home, ".jevis/nudges");
  mkdirSync(custom, { recursive: true });
  writeFileSync(join(custom, "base-prompt.md"), "---\nhook: prompt\n---\nPERSONAL_TIP_NOT_FOR_PUBLICATION\n");
  writeFileSync(join(repo, "nudges/html-example.md"), "---\nhook: prompt\n---\nKeep <script>alert('x')</script> & A > B. [Details](guide.md#example).\n");
  const env = { PATH: process.env.PATH, ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}), HOME: home, USERPROFILE: home, JEVIS_HOME: join(home, ".jevis"), JEVIS_NUDGES_DIR: custom };
  const run = (...args) => spawnSync(process.execPath, [join(alias, "docs/build.mjs"), ...args], { env, encoding: "utf8", timeout: 10000 });
  const index = join(repo, "docs/index.html");
  const stale = run("--check");
  assert.equal(stale.status, 1, stale.stderr);
  assert.match(stale.stderr, /is stale/);
  assert.equal(readFileSync(index, "utf8"), readFileSync(join(root, "docs/index.html"), "utf8"), "check mode must not write");
  const rebuilt = run();
  assert.equal(rebuilt.status, 0, rebuilt.stderr);
  const html = readFileSync(index, "utf8");
  assert.doesNotMatch(html, /PERSONAL_TIP_NOT_FOR_PUBLICATION|<script>alert/);
  assert.match(html, /&lt;script&gt;alert\('x'\)&lt;\/script&gt; &amp; A &gt; B/);
  assert.match(html, /href="https:\/\/github.com\/GLDRoger\/jevis\/blob\/main\/nudges\/guide.md#example"/);
  assert.equal(run("--check").status, 0);
  assert.equal(existsSync(join(home, ".jevis/log.jsonl")), false, "building docs must not create hook state");
});

test("new scenario captures cannot replace the archived v1 answers", (t) => {
  const scratch = mkdtempSync(join(tmpdir(), "jevis-capture-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  for (const path of ["eval", "src", "archive/manual-v1"]) mkdirSync(join(scratch, path), { recursive: true });
  cpSync(join(root, "eval/scenarios.mjs"), join(scratch, "eval/scenarios.mjs"));
  // Only the output boundary is under test; do not make paid provider calls.
  writeFileSync(join(scratch, "src/engine.mjs"), 'export async function evaluate() { return { scores: {}, profile: {}, fired: [], ms: 0 }; }\n');
  writeFileSync(join(scratch, "src/wiki.mjs"), 'export function loadWiki() { return { entries: [] }; }\n');
  writeFileSync(join(scratch, "src/axes.mjs"), 'export const AXES = {};\n');
  const archive = join(scratch, "archive/manual-v1/scenarios.json");
  const frozen = '{"recorded":"synthetic frozen v1 fixture"}\n';
  writeFileSync(archive, frozen);
  const result = spawnSync(process.execPath, [join(scratch, "eval/scenarios.mjs")], { encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(archive, "utf8"), frozen);
  const capture = JSON.parse(readFileSync(join(scratch, "eval/out/scenarios.json"), "utf8"));
  assert.ok(capture.scenarios.length > 0);
});
