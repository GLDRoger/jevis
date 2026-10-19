import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { LEGACY_SEARCH, onSession, onTool } from "../src/hooks.mjs";

const root = mkdtempSync(join(tmpdir(), "jevis-search-"));
for (const k of Object.keys(process.env)) if (k.startsWith("JEVIS_")) delete process.env[k];
Object.assign(process.env, { JEVIS_HOME: join(root, "home"), JEVIS_NUDGES_DIR: join(root, "nudges"), JEVIS_WIKI: join(root, "wiki"), JEVIS_JEV: "off" });
for (const d of [process.env.JEVIS_HOME, process.env.JEVIS_NUDGES_DIR, process.env.JEVIS_WIKI]) mkdirSync(d);
writeFileSync(join(process.env.JEVIS_NUDGES_DIR, "search.md"), "---\nhook: search\n---\nuse rg.\n");
const bash = (command) => onTool({ session_id: "s", cwd: root, tool_name: "Bash", tool_input: { command } });
const context = (r) => r?.hookSpecificOutput?.additionalContext;

test("search tip: matches grep/find as commands only", () => {
  for (const c of ["grep -r x .", "ls | grep x", "cd a && find . -name x", "xargs -0 grep x", "$(find . -type f)"]) assert.ok(LEGACY_SEARCH.test(c), c);
  for (const c of ["git grep x", "rg x", "echo grep me", "fd x", "npm run find-deps"]) assert.ok(!LEGACY_SEARCH.test(c), c);
});

test("search tip: once per session, again after compaction, never for rg", async () => {
  assert.equal(await bash("rg foo"), null);
  assert.equal(context(await bash("grep -r foo .")), "use rg.");
  assert.equal(await bash("find . -name x"), null, "once per session");
  onSession({ session_id: "s", cwd: root, source: "compact" });
  assert.equal(context(await bash("grep foo bar")), "use rg.", "compaction removed the earlier tip from context");
});
