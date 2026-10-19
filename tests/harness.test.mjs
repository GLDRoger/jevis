import assert from "node:assert/strict";
import { test } from "node:test";
import { harnessOf } from "../src/context.mjs";

test("harness: a Claude Code transcript wins even when the event names a model", () => {
  const claude = { transcript_path: "/Users/x/.claude/projects/-a/s.jsonl", model: "claude-opus-5-5" };
  assert.deepEqual(harnessOf(claude), { harness: "Claude Code", model: "claude-opus-5-5" });
  assert.equal(harnessOf({ permission_mode: "default" }).harness, "Claude Code");
  assert.deepEqual(harnessOf({ model: "gpt-6.1-sol", transcript_path: "/Users/x/.codex/sessions/r.jsonl" }), { harness: "Codex", model: "gpt-6.1-sol" });
});
