import { closeSync, fstatSync, lstatSync, openSync, readSync, constants } from 'node:fs';
import { resolve } from 'node:path';

// Google CLI transcripts are not Codex/Claude transcripts. Antigravity's
// JSONL rows supplement tool-hook evidence; Gemini uses its tool-hook payloads.
export function antigravityMessages(path) {
  if (!path) return [];
  let fd;
  try {
    // Windows has no O_NOFOLLOW, so a link is refused by lstat first; O_NOFOLLOW still closes the race where it exists.
    if (lstatSync(path).isSymbolicLink()) return [];
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = fstatSync(fd);
    if (!stat.isFile()) return [];
    const size = Math.min(stat.size, 4 * 1024 * 1024);
    const buffer = Buffer.alloc(size);
    readSync(fd, buffer, 0, size, stat.size - size);
    const lines = buffer.toString('utf8').split('\n');
    if (stat.size > size) lines.shift();
    return lines.flatMap(line => {
      try {
        const row = JSON.parse(line);
        return ['USER_INPUT', 'PLANNER_RESPONSE', 'GENERIC'].includes(row.type) && typeof row.content === 'string' ? [row] : [];
      } catch { return []; }
    });
  } catch { return []; }
  finally { if (fd !== undefined) closeSync(fd); }
}

export function antigravityExitCode(row) {
  const match = row?.type === 'GENERIC' && row.content?.match(/^Created At: [^\n]+\nCompleted At: [^\n]+\n\nThe command exited with code (-?\d+)\.\n(?:Output|Stdout):/);
  return match ? Number(match[1]) : undefined;
}

export function googleTool(name, args = {}) {
  if (['run_shell_command', 'run_command'].includes(name)) return { tool: 'Bash', input: { command: args.command ?? args.CommandLine ?? '' } };
  if (['write_file', 'write_to_file'].includes(name)) return { tool: 'Write', input: { file_path: args.file_path ?? args.TargetFile, content: args.content ?? args.CodeContent ?? '' } };
  if (['replace', 'replace_file_content'].includes(name)) return { tool: 'Edit', input: { file_path: args.file_path ?? args.TargetFile, old_string: args.old_string ?? args.TargetContent, new_string: args.new_string ?? args.ReplacementContent } };
  if (name === 'multi_replace_file_content') return { tool: 'MultiEdit', input: { file_path: args.TargetFile, edits: (args.ReplacementChunks ?? []).map(c => ({ old_string: c.TargetContent, new_string: c.ReplacementContent })) } };
  return { tool: name, input: args };
}

export function geminiShellResponse(response, toolName, args = {}) {
  if (toolName !== 'Bash' || response?.error) return response?.error ? { ...response, is_error: true } : response;
  const text = response?.llmContent;
  if (typeof text !== 'string') return response;
  const unwrapped = text.replace(/^<untrusted_context>\n/, '').replace(/\n<\/untrusted_context>$/, '');
  if (!unwrapped.startsWith('Output: ') || !/\nProcess Group PGID: \d+$/.test(unwrapped)) return response;
  // Gemini's shell tool appends transport metadata after stdout. The final
  // PGID anchors the trailer; prose claiming tests passed is never status.
  const lines = unwrapped.split('\n');lines.pop();
  // Parse each transport field at most once, in reverse transport order.
  // Repeated label-shaped stdout must not override a real nonzero exit.
  if (lines.at(-1)?.startsWith('Background PIDs:') || args.is_background) return { ...response, status: 'running' };
  if (lines.at(-1)?.startsWith('Signal:')) return { ...response, is_error: true };
  let exit = 0;
  const code = lines.at(-1)?.match(/^Exit Code: (-?\d+)$/);
  if (code) { exit = Number(code[1]); lines.pop(); }
  // A multiline spawn error cannot be distinguished from stdout by this
  // text-only API. Stay unknown rather than manufacture a successful exit.
  if (lines.some(line => line.startsWith('Error:'))) return response;
  return { ...response, exit_code: exit };
}

export function antigravityReceiptRefreshes(input, rows, results) {
  return results.flatMap(row => {
    if (row.turnId !== input.turn_id || row.it?.type !== 'CommandExecution' || !row.it.id) return [];
    const receipt = rows.find(r => r.step_index?.toString() === row.it.id);
    const exit = antigravityExitCode(receipt);
    return exit === undefined ? [] : [{ ...input, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: row.it.command }, tool_use_id: row.it.id, tool_response: { exit_code: exit } }];
  });
}

export function googleInput(provider, event, raw, rows = []) {
  const agy = provider === 'antigravity';
  const mapped = googleTool(agy ? raw.toolCall?.name : raw.tool_name, agy ? raw.toolCall?.args : raw.tool_input);
  if (!agy && raw.mcp_context?.server_name && raw.mcp_context?.tool_name) mapped.tool = `mcp__${raw.mcp_context.server_name}__${raw.mcp_context.tool_name}`;
  const { tool, input } = mapped;
  const toolRow = rows.find(r => r.type === 'GENERIC' && r.step_index === raw.stepIdx);
  const commandExit = antigravityExitCode(toolRow);
  const user = rows.filter(r => r.type === 'USER_INPUT').at(-1);
  const final = rows.filter(r => r.type === 'PLANNER_RESPONSE' && (!user || r.step_index > user.step_index)).at(-1);
  const events = { BeforeAgent: 'UserPromptSubmit', PreInvocation: 'UserPromptSubmit', BeforeTool: 'PreToolUse', PreToolUse: 'PreToolUse', AfterTool: 'PostToolUse', PostToolUse: 'PostToolUse', AfterAgent: 'Stop', Stop: 'Stop', SessionStart: 'SessionStart' };
  // Prefix sessions so identical UUIDs from different harnesses never share state.
  const session = agy ? raw.conversationId : raw.session_id;
  return {
    session_id: `${provider}-${session ?? ''}`,
    cwd: agy ? raw.workspacePaths?.[0] : raw.cwd,
    model_provider: provider,
    model: agy ? raw.modelName : raw.model,
    transcript_path: null,
    hook_event_name: events[event],
    prompt: agy ? user?.content?.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/)?.[1] ?? user?.content : raw.prompt,
    turn_id: agy ? user?.step_index?.toString() : raw.turn_id,
    last_assistant_message: agy ? final?.content : typeof raw.prompt_response === 'string' ? raw.prompt_response.slice(-3000) : undefined,
    source: raw.source,
    tool_name: tool,
    tool_input: input,
    tool_use_id: agy ? raw.stepIdx?.toString() : raw.tool_use_id,
    // Only Antigravity's transport-generated completion header can prove a
    // command exit. Missing error alone may describe a background launch.
    tool_response: agy ? { ...(commandExit !== undefined ? { exit_code: Number(commandExit) } : {}), is_error: !!raw.error } : geminiShellResponse(raw.tool_response, tool, input),
  };
}

export function googleOutput(provider, event, output) {
  if (!output) return provider === 'antigravity' && event === 'PreToolUse' ? { decision: 'ask' } : {};
  const specific = output.hookSpecificOutput ?? {};
  const deny = specific.permissionDecision === 'deny' || output.decision === 'block';
  const reason = specific.permissionDecisionReason ?? output.reason;
  if (provider === 'antigravity') {
    if (deny) return { decision: event === 'Stop' ? 'continue' : 'deny', reason };
    if (specific.additionalContext && ['SessionStart', 'PreInvocation'].includes(event)) return { injectSteps: [{ ephemeralMessage: specific.additionalContext }] };
    // Antigravity PreToolUse has no context-injection output field. Notes have
    // already been selected by Jevis; the adapter runner queues them for the next invocation.
    return event === 'PreToolUse' ? { decision: 'ask' } : {};
  }
  if (deny) return { decision: 'deny', reason };
  if (event === 'BeforeTool') return {}; // delivered by AfterTool, not ignored by Gemini
  return specific.additionalContext ? { hookSpecificOutput: { hookEventName: event, additionalContext: specific.additionalContext } } : {};
}

// Already absolute and normalized; on Windows, forward slashes (C:/w) count as the same path.
const absoluteResolved = (cwd, platform = process.platform) => cwd === resolve(cwd) || (platform === 'win32' && cwd.replaceAll('/', '\\') === resolve(cwd));

export function validGoogleInput(provider, raw) {
  const session = provider === 'antigravity' ? raw.conversationId : raw.session_id;
  const cwd = provider === 'antigravity' ? raw.workspacePaths?.[0] : raw.cwd;
  return typeof session === 'string' && session.length > 0 && session.length <= 200 && /^[\w-]+$/.test(session) && typeof cwd === 'string' && absoluteResolved(cwd);
}
