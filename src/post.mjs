import { clip, harnessOf, hookItem, museTool } from "./context.mjs";
import { redactDeep } from "./redact.mjs";

export const RESULT_MEMORY = 200;
export const RESULT_CLIP = 4000;

/** Only transport status, never arbitrary output text asserting "passed".
 * Codex can finish nonzero and sends model-facing text; Claude's successful
 * PostToolUse guarantees success, but a background launch is not completion.
 */
export function toolResult(input, { now = Date.now(), startedAt = null, endedAt = null } = {}) {
  const { harness } = harnessOf(input, { withModel: false });
  const { tool, input: args } = harness === "Muse Code" ? museTool(input.tool_name, input.tool_input) : { tool: input.tool_name, input: input.tool_input };
  const it = redactDeep(hookItem(tool, typeof args === "string" ? { command: args, input: args } : args ?? {}));
  if (!it) return null;
  let response = input.tool_response;
  if (typeof response === "string" && response.length < 16_384) {
    try { response = JSON.parse(response); } catch { /* Codex model-facing text */ }
  }
  const object = response && typeof response === "object" ? response : {};
  const text = typeof response === "string" ? response.slice(0, 16_384) : typeof input.error === "string" ? input.error.slice(0, 16_384) : "";
  const status = object.status;
  const pending = object.session_id != null && object.exit_code == null || object.backgroundTaskId || /^(?:running|in_progress|async_launched)$/.test(status ?? "") || /^Process running with session ID\b/im.test(text);
  const code = object.exit_code ?? object.exitCode ?? text.match(/^(?:Process exited with code|Process exit code:|Exit code[: ])\s*(-?\d+)\b/im)?.[1];
  const exitCode = code != null && /^-?\d+$/.test(String(code)) ? Number(code) : null;
  const failed = input.hook_event_name === "PostToolUseFailure" || object.is_error === true || object.isError === true || object.success === false || object.interrupted === true || /^(?:failed|error|errored|cancelled|canceled)$/.test(status ?? "");
  const success = pending ? null : failed ? false : exitCode !== null ? exitCode === 0 : object.success === true || harness === "Claude Code" && input.hook_event_name === "PostToolUse" || tool === "apply_patch" && /^Success\. Updated the following files:/m.test(text) ? true : null;
  Object.assign(it, { success, completed: !pending, id: clip(input.tool_use_id ?? "", 200) || undefined });
  if (it.type === "CommandExecution") {
    it.command = clip(Array.isArray(it.command) ? it.command.at(-1) : it.command, RESULT_CLIP);
    it.exit_code = exitCode;
  }
  if (it.type === "FileChange") it.changes = it.changes.slice(0, 20).map((c) => ({ path: clip(c.path, 200) }));
  if (it.type === "McpToolCall") {
    // Result evidence needs the tool identity, not potentially huge arguments
    // or output (which may include file contents and secrets).
    it.server = clip(it.server, 100);
    it.tool = clip(it.tool, 100);
    delete it.arguments;
  }
  const execution = {
    start: Number.isFinite(startedAt) && startedAt >= 0 ? startedAt : null,
    end: !pending && Number.isFinite(endedAt) && endedAt >= 0 ? endedAt : null,
  };
  return redactDeep({ t: execution.end ?? execution.start, execution, receivedAt: now, turnId: clip(input.turn_id ?? "", 200) || undefined, it });
}
