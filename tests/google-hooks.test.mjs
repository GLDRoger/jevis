import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, symlinkSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { antigravityMessages, antigravityReceiptRefreshes, antigravityExitCode, googleTool, googleInput, googleOutput, validGoogleInput } from '../src/google-hooks.mjs';
import { harnessOf, turnEvidence } from '../src/context.mjs';
import { toolResult } from '../src/post.mjs';

test('Google providers are identified without changing Codex or Claude', () => {
  assert.equal(harnessOf({ model_provider: 'gemini-cli', model: 'gemini-4-argon' }).harness, 'Gemini CLI');
  assert.equal(harnessOf({ model_provider: 'antigravity' }).harness, 'Antigravity CLI');
  assert.equal(harnessOf({ model: 'gpt-6.1-sol' }).harness, 'Codex');
  assert.equal(harnessOf({ permission_mode: 'default' }).harness, 'Claude Code');
});
test('Google tool names and edit arguments use the canonical Jevis vocabulary', () => {
  assert.deepEqual(googleTool('run_shell_command', { command: 'npm test' }), { tool: 'Bash', input: { command: 'npm test' } });
  assert.deepEqual(googleTool('write_to_file', { TargetFile: '/w/a', CodeContent: 'hi' }), { tool: 'Write', input: { file_path: '/w/a', content: 'hi' } });
  assert.equal(googleTool('replace', { file_path: '/w/a', new_string: 'hi' }).input.new_string, 'hi');
  assert.deepEqual(googleTool('multi_replace_file_content', { TargetFile: '/w/a', ReplacementChunks: [{ TargetContent: 'old', ReplacementContent: 'new' }] }).input.edits, [{ old_string: 'old', new_string: 'new' }]);
});
test('Gemini input does not pass its unsupported transcript to Jevis', () => {
  const input = googleInput('gemini-cli', 'AfterAgent', { session_id: 's', cwd: '/w', transcript_path: '/w/session.json', prompt_response: 'Done' });
  assert.equal(input.session_id, 'gemini-cli-s');
  assert.equal(input.transcript_path, null);
  assert.equal(input.last_assistant_message, 'Done');
  assert.equal(input.hook_event_name, 'Stop');
});
test('Antigravity uses the latest user step and only a final after that step', () => {
  const raw = { conversationId: 's', workspacePaths: ['/w'], modelName: 'gemini-4' };
  const rows = [{ type: 'USER_INPUT', step_index: 1, content: 'old' }, { type: 'PLANNER_RESPONSE', step_index: 2, content: 'old final' }, { type: 'USER_INPUT', step_index: 3, content: 'new' }];
  const input = googleInput('antigravity', 'PreInvocation', raw, rows);
  assert.equal(input.prompt, 'new');assert.equal(input.turn_id, '3');assert.equal(input.last_assistant_message, undefined);
  assert.equal(input.cwd, '/w');
});
test('Google deny and retry outputs preserve actual enforcement', () => {
  const denied = { hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: 'Unsafe' } };
  assert.deepEqual(googleOutput('gemini-cli', 'BeforeTool', denied), { decision: 'deny', reason: 'Unsafe' });
  assert.deepEqual(googleOutput('antigravity', 'PreToolUse', denied), { decision: 'deny', reason: 'Unsafe' });
  assert.deepEqual(googleOutput('antigravity', 'Stop', { decision: 'block', reason: 'Verify first' }), { decision: 'continue', reason: 'Verify first' });
});
test('Context is emitted only in provider-supported shapes', () => {
  const note = { hookSpecificOutput: { additionalContext: 'lesson' } };
  assert.deepEqual(googleOutput('gemini-cli', 'BeforeAgent', note), { hookSpecificOutput: { hookEventName: 'BeforeAgent', additionalContext: 'lesson' } });
  assert.deepEqual(googleOutput('antigravity', 'PreInvocation', note), { injectSteps: [{ ephemeralMessage: 'lesson' }] });
  assert.deepEqual(googleOutput('antigravity', 'PreToolUse', note), { decision: 'allow' });
  assert.deepEqual(googleOutput('antigravity', 'PreToolUse', null), { decision: 'allow' });
});
test('Successful and failed Antigravity post-tool calls are distinguished', () => {
  const raw = { conversationId: 's', workspacePaths: ['/w'], toolCall: { name: 'run_command', args: { CommandLine: 'npm test' } } };
  assert.equal(toolResult(googleInput('antigravity', 'PostToolUse', raw)).it.success, null);
  const rows = [{ type: 'GENERIC', step_index: 3, content: 'Created At: now\nCompleted At: later\n\nThe command exited with code 0.\nOutput:\nhello' }];
  assert.equal(antigravityExitCode(rows[0]), 0);
  assert.equal(antigravityExitCode({ type: 'USER_INPUT', content: rows[0].content }), undefined);
  assert.equal(toolResult(googleInput('antigravity', 'PostToolUse', { ...raw, stepIdx: 3 }, rows)).it.success, true);
  assert.equal(toolResult(googleInput('antigravity', 'PostToolUse', { ...raw, error: 'exit status 1' })).it.success, false);
});
test('Gemini error responses cannot become passing test evidence', () => {
  const raw = { session_id: 's', cwd: '/w', tool_name: 'run_shell_command', tool_input: { command: 'npm test' }, tool_response: { error: { message: 'failed' } } };
  assert.equal(toolResult(googleInput('gemini-cli', 'AfterTool', raw)).it.success, false);
});
test('Transcript reads reject symlinks, malformed rows and non-message steps', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jevis-google-transcript-'));const p = join(dir, 'transcript.jsonl');
  writeFileSync(p, 'broken\n'+JSON.stringify({ type: 'USER_INPUT', step_index: 1, content: 'hello' })+'\n'+JSON.stringify({ type: 'TOOL_CALL', content: 'ignored' })+'\n');
  symlinkSync(p, join(dir, 'link'));
  assert.equal(antigravityMessages(p).length, 1);assert.deepEqual(antigravityMessages(join(dir, 'link')), []);assert.deepEqual(antigravityMessages(dir), []);
});
test('Invalid session IDs and relative workspaces are rejected', () => {
  assert.equal(validGoogleInput('gemini-cli', { session_id: '../escape', cwd: '/w' }), false);
  assert.equal(validGoogleInput('antigravity', { conversationId: 'id', workspacePaths: ['relative'] }), false);
  assert.equal(validGoogleInput('gemini-cli', { session_id: 'uuid-1', cwd: resolve('/w') }), true);
  if (process.platform === 'win32') assert.equal(validGoogleInput('gemini-cli', { session_id: 'uuid-1', cwd: resolve('/w').replaceAll('\\', '/') }), true);
});

test('Gemini shell transport footer records zero and nonzero exits, not claims in output', () => {
  const base = { session_id: 's', cwd: '/w', tool_name: 'run_shell_command', tool_input: { command: 'npm test' } };
  const wrap = text => ({ llmContent: `<untrusted_context>\n${text}\n</untrusted_context>` });
  assert.equal(toolResult(googleInput('gemini-cli', 'AfterTool', { ...base, tool_response: wrap('Output: passed\nProcess Group PGID: 123') })).it.success, true);
  assert.equal(toolResult(googleInput('gemini-cli', 'AfterTool', { ...base, tool_response: wrap('Output: passed\nExit Code: 7\nProcess Group PGID: 123') })).it.success, false);
  assert.equal(toolResult(googleInput('gemini-cli', 'AfterTool', { ...base, tool_response: wrap('Output: passed') })).it.success, null);
  assert.equal(toolResult(googleInput('gemini-cli', 'AfterTool', { ...base, tool_response: wrap('Output: started\nBackground PIDs: 456\nProcess Group PGID: 123') })).it.completed, false);
});
test('Gemini Stop uses the end of cumulative output rather than earlier narration', () => {
  const input = googleInput('gemini-cli', 'AfterAgent', { session_id: 's', cwd: '/w', prompt_response: 'old narration '.repeat(1000)+'FINAL ANSWER' });
  assert.equal(input.last_assistant_message.length, 3000);
  assert.ok(input.last_assistant_message.endsWith('FINAL ANSWER'));
});
test('Antigravity strips user-request wrappers without absorbing metadata', () => {
  const input = googleInput('antigravity', 'PreInvocation', { conversationId: 's', workspacePaths: ['/w'] }, [{ type: 'USER_INPUT', step_index: 0, content: '<USER_REQUEST>\nhello\n</USER_REQUEST><ADDITIONAL_METADATA>noise</ADDITIONAL_METADATA>' }]);
  assert.equal(input.prompt, 'hello');
});
test('Gemini MCP metadata produces canonical MCP evidence', () => {
  const input = googleInput('gemini-cli', 'BeforeTool', { session_id: 's', cwd: '/w', tool_name: 'mcp_browser_navigate', tool_input: { url: 'https://example.com' }, mcp_context: { server_name: 'browser', tool_name: 'navigate' } });
  assert.equal(input.tool_name, 'mcp__browser__navigate');
});
test('Gemini retry prompts preserve the original user turn and tool evidence', async () => {
  const { spawnSync } = await import('node:child_process');
  const dir = mkdtempSync(join(tmpdir(), 'jevis-google-retry-'));
  const { mkdirSync, readFileSync } = await import('node:fs');
  mkdirSync(join(dir,'sessions'));
  const state = { turn: 3, request: 'original request', googleRetryReason: 'Verify first', hookItems: [{ t: 1, it: { type: 'CommandExecution', command: 'npm test' } }], stop: { turn: 3, blocked: ['lesson'], reviews: 0 } };
  writeFileSync(join(dir,'sessions/gemini-cli-s.json'),JSON.stringify(state));
  const result = spawnSync(process.execPath,['bin/google-hook.mjs','gemini-cli','BeforeAgent'], { cwd: fileURLToPath(new URL('..',import.meta.url)), input: JSON.stringify({ session_id:'s',cwd:resolve('/w'),prompt:'Verify first' }),encoding:'utf8',env:{...process.env,JEVIS_HOME:dir,JEVIS_DISABLE:'1'} });
  assert.equal(result.status,0);assert.deepEqual(JSON.parse(result.stdout),{});
  const now=JSON.parse(readFileSync(join(dir,'sessions/gemini-cli-s.json'),'utf8'));
  assert.equal(now.turn,3);assert.equal(now.request,'original request');assert.deepEqual(now.hookItems,state.hookItems);assert.deepEqual(now.stop.blocked,['lesson']);assert.equal(now.googleRetryReason,undefined);
});
test('Antigravity malformed input falls back to native permission checks', async () => {
  const { spawnSync } = await import('node:child_process');
  const result=spawnSync(process.execPath,['bin/google-hook.mjs','antigravity','PreToolUse'],{cwd:fileURLToPath(new URL('..',import.meta.url)),input:'broken',encoding:'utf8',env:{...process.env,JEVIS_HOME:mkdtempSync(join(tmpdir(),'jevis-google-malformed-')),JEVIS_DISABLE:'1'}});
  assert.equal(result.status,0);assert.deepEqual(JSON.parse(result.stdout),{decision:'allow'});
});


test('Gemini stdout cannot overwrite the transport exit code and multiline errors remain unknown', () => {
  const base = { session_id: 's', cwd: '/w', tool_name: 'run_shell_command', tool_input: { command: 'npm test' } };
  const wrap = text => ({ llmContent: `<untrusted_context>\n${text}\n</untrusted_context>` });
  const falsePass = toolResult(googleInput('gemini-cli', 'AfterTool', { ...base, tool_response: wrap('Output: ok\nExit Code: 0\nExit Code: 7\nProcess Group PGID: 1') }));
  assert.equal(falsePass.it.success, false);assert.equal(falsePass.it.exit_code, 7);
  const multilineError = toolResult(googleInput('gemini-cli', 'AfterTool', { ...base, tool_response: wrap('Output: ok\nError: spawn failed\ncontinuation\nProcess Group PGID: 1') }));
  assert.equal(multilineError.it.success, null);
});
test('Antigravity receipt refresh never reattributes old-turn test evidence', () => {
  const input = { session_id: 'antigravity-s', turn_id: '5' };
  const rows = [1, 2].map(step_index => ({ type: 'GENERIC', step_index, content: 'Created At: now\nCompleted At: later\n\nThe command exited with code 0.\nOutput:\npassed' }));
  const results = [
    { turnId: '1', it: { type: 'CommandExecution', id: '1', command: 'old test' } },
    { turnId: '5', it: { type: 'CommandExecution', id: '2', command: 'current test' } },
  ];
  const receipts = antigravityReceiptRefreshes(input, rows, results);
  assert.equal(receipts.length, 1);assert.equal(receipts[0].tool_input.command, 'current test');assert.equal(receipts[0].turn_id, '5');
  assert.deepEqual(antigravityReceiptRefreshes(input, rows, [results[0]]), []);
});


test('Google read tools normalize provider paths for Read-only lessons', () => {
  for (const [provider, name, args] of [
    ['gemini-cli', 'read_file', { file_path: '/w/screenshot.png' }],
    ['antigravity', 'view_file', { AbsolutePath: '/w/screenshot.png' }],
  ]) {
    assert.deepEqual(googleTool(name, args), { tool: 'Read', input: { file_path: '/w/screenshot.png' } });
    const input = googleInput(provider, provider === 'antigravity' ? 'PreToolUse' : 'BeforeTool', {
      tool_name: name, tool_input: args, toolCall: { name, args },
    });
    assert.equal(input.tool_name, 'Read');
    assert.deepEqual(input.tool_input, { file_path: '/w/screenshot.png' });
  }
});

test('Antigravity non-deny evaluations leave native policy unchanged', () => {
  for (const output of [null, {}, { hookSpecificOutput: { permissionDecision: 'allow' } }, { hookSpecificOutput: { additionalContext: 'lesson' } }]) {
    assert.deepEqual(googleOutput('antigravity', 'PreToolUse', output), { decision: 'allow' });
  }
});

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
async function runAntigravity(home, event, raw, env = {}) {
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(process.execPath, ['bin/google-hook.mjs', 'antigravity', event], {
    cwd: repo, input: JSON.stringify(raw), encoding: 'utf8', timeout: 10000,
    env: { ...process.env, JEVIS_HOME: home, JEVIS_DISABLE: '', JEVIS_JEV: 'off', JEVIS_CRITIC: 'off', JEVIS_SCOPE: '', JEVIS_RECORD: 'off', ...env },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('Antigravity Stop runs on model_stop and legacy completion, not errors or limits', async () => {
  for (const [terminationReason, ran] of [['model_stop', true], ['NO_TOOL_CALL', true], ['max_steps_exceeded', false], ['error', false], ['cancelled', false]]) {
    const home = mkdtempSync(join(tmpdir(), 'jevis-google-stop-'));
    assert.deepEqual(await runAntigravity(home, 'Stop', { conversationId: 's', workspacePaths: [repo], terminationReason }), {});
    const logs = readFileSync(join(home, 'log.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(logs.find(row => row.event === 'google-hook').ran, ran, terminationReason);
  }
});

test('Antigravity timestamped receipts persist execution intervals and credit checks after an edit', async () => {
  const home = mkdtempSync(join(tmpdir(), 'jevis-google-times-'));
  const transcript = join(home, 'transcript.jsonl');
  const session = join(home, 'sessions', 'antigravity-s.json');
  const editAt = Date.parse('2026-10-15T10:00:00Z');
  const start = editAt + 1000, end = editAt + 2000;
  const receipt = (created, completed) => ({ type: 'GENERIC', step_index: 2, content: `Created At: ${created}\nCompleted At: ${completed}\n\nThe command exited with code 0.\nOutput:\npassed` });
  const raw = { conversationId: 's', workspacePaths: [repo], transcriptPath: transcript, stepIdx: 2, toolCall: { name: 'run_command', args: { CommandLine: 'npm test' } } };
  const edit = { t: editAt, execution: { start: editAt - 1000, end: editAt }, it: { type: 'FileChange', changes: [{ path: 'a.mjs' }], success: true } };
  mkdirSync(join(home, 'sessions'));
  const reset = () => writeFileSync(session, JSON.stringify({ hookResults: [edit] }));
  const rows = [ { type: 'USER_INPUT', step_index: 1, content: 'fix code' }, receipt(new Date(start).toISOString(), new Date(end).toISOString()) ];
  reset();
  writeFileSync(transcript, rows.map(JSON.stringify).join('\n'));
  await runAntigravity(home, 'PostToolUse', raw);
  const stored = () => JSON.parse(readFileSync(session, 'utf8')).hookResults;
  let check = stored().find(row => row.it.type === 'CommandExecution');
  assert.equal(check.it.success, true);
  assert.deepEqual(check.execution, { start, end });
  assert.deepEqual(turnEvidence(stored()).checks_after_last_edit, [{ command: 'npm test', success: true, exit_code: 0 }]);

  // If PostToolUse precedes transcript persistence, Stop refreshes the same receipt.
  reset();
  writeFileSync(transcript, JSON.stringify(rows[0]));
  await runAntigravity(home, 'PostToolUse', raw);
  assert.equal(stored().find(row => row.it.type === 'CommandExecution').it.success, null);
  writeFileSync(transcript, rows.map(JSON.stringify).join('\n'));
  await runAntigravity(home, 'Stop', { ...raw, terminationReason: 'model_stop' });
  check = stored().find(row => row.it.type === 'CommandExecution');
  assert.equal(stored().length, 2);
  assert.deepEqual(check.execution, { start, end });
  assert.equal(turnEvidence(stored()).checks_after_last_edit[0].success, true);

  for (const env of [{ JEVIS_DISABLE: '1' }, { JEVIS_SCOPE: join(home, 'outside-workspace') }]) {
    const before = readFileSync(session, 'utf8');
    await runAntigravity(home, 'PostToolUse', raw, env);
    assert.equal(readFileSync(session, 'utf8'), before, 'timing translation honors disabled/scope boundaries');
  }

  // Missing, invalid, reversed and overlapping intervals cannot prove a post-edit check.
  for (const [created, completed] of [
    ['unknown', 'unknown'], [new Date(start).toISOString(), 'unknown'],
    [new Date(end).toISOString(), new Date(start).toISOString()],
    [new Date(editAt - 1000).toISOString(), new Date(end).toISOString()],
  ]) {
    reset();
    writeFileSync(transcript, [rows[0], receipt(created, completed)].map(JSON.stringify).join('\n'));
    await runAntigravity(home, 'PostToolUse', raw);
    assert.equal(turnEvidence(stored()).checks_after_last_edit[0].success, null, `${created} / ${completed}`);
  }
});


test('Antigravity valid disabled and non-deny tool calls defer to native policy', async () => {
  for (const disabled of ['', '1']) {
    const home = mkdtempSync(join(tmpdir(), 'jevis-google-policy-'));
    const output = await runAntigravity(home, 'PreToolUse', {
      conversationId: 's', workspacePaths: [repo], stepIdx: 2,
      toolCall: { name: 'view_file', args: { AbsolutePath: join(repo, 'README.md') } },
    }, { JEVIS_DISABLE: disabled });
    assert.deepEqual(output, { decision: 'allow' });
  }
});

test('README Google configurations cover supported events and run each adapter command', async () => {
  const { spawnSync } = await import('node:child_process');
  const section = readFileSync(join(repo, 'README.md'), 'utf8').split('### Gemini CLI and Antigravity CLI')[1]?.split('## How it works')[0];
  assert.ok(section, 'manual setup subsection exists');
  const examples = [...section.matchAll(/```json\n([\s\S]*?)\n```/g)].map(match => JSON.parse(match[1]));
  assert.equal(examples.length, 2);
  for (const [index, provider, events] of [
    [0, 'gemini-cli', ['SessionStart', 'BeforeAgent', 'BeforeTool', 'AfterTool', 'AfterAgent']],
    [1, 'antigravity', ['SessionStart', 'PreInvocation', 'PreToolUse', 'PostToolUse', 'Stop']],
  ]) {
    const hooks = index === 0 ? examples[index].hooks : examples[index].jevis;
    assert.deepEqual(Object.keys(hooks), events);
    for (const event of events) {
      assert.equal(hooks[event].length, 1);
      const group = hooks[event][0];
      const toolEvent = /Tool/.test(event);
      if (toolEvent) assert.equal(group.matcher, '*');
      const handler = index === 0 || toolEvent ? group.hooks[0] : group;
      assert.equal(handler.type, 'command');
      assert.equal(handler.command, `node "<repo>/bin/google-hook.mjs" ${provider} ${event}`);
      assert.equal(handler.timeout, (['AfterAgent', 'Stop'].includes(event) ? 420 : 10) * (index === 0 ? 1000 : 1));
      const home = mkdtempSync(join(tmpdir(), 'jevis-google-readme-'));
      const result = spawnSync(process.execPath, [join(repo, 'bin/google-hook.mjs'), provider, event], {
        cwd: repo, input: JSON.stringify({ session_id: 's', cwd: repo, conversationId: 's', workspacePaths: [repo], terminationReason: 'model_stop' }),
        encoding: 'utf8', timeout: 10000, env: { ...process.env, JEVIS_HOME: home, JEVIS_DISABLE: '1' },
      });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), provider === 'antigravity' && event === 'PreToolUse' ? { decision: 'allow' } : {});
    }
  }
});
