#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { applyConfig } from '../src/config.mjs';
import { onPrompt, onTool, onPost, onStop, onSession } from '../src/hooks.mjs';
import { loadSession, saveSession, log } from '../src/state.mjs';
import { antigravityMessages, antigravityReceiptRefreshes, googleInput, googleOutput, validGoogleInput } from '../src/google-hooks.mjs';

applyConfig();
const [provider, event] = process.argv.slice(2);
const handlers = { BeforeAgent: onPrompt, PreInvocation: onPrompt, BeforeTool: onTool, PreToolUse: onTool, AfterTool: onPost, PostToolUse: onPost, AfterAgent: onStop, Stop: onStop, SessionStart: onSession };
let input;
let result = googleOutput(provider, event, null);
try {
  const raw = JSON.parse(readFileSync(0, 'utf8'));
  if (['gemini-cli', 'antigravity'].includes(provider) && validGoogleInput(provider, raw) && handlers[event]) {
    const rows = provider === 'antigravity' && ['PreInvocation', 'PostToolUse', 'Stop'].includes(event) ? antigravityMessages(raw.transcriptPath) : [];
    input = googleInput(provider, event, raw, rows);
    let run = true;
    if (event === 'PreInvocation') {
      const session = loadSession(input.session_id);
      run = input.prompt != null && input.turn_id !== session.googleUserStep;
    }
    if (provider === 'gemini-cli' && event === 'BeforeAgent') {
      const session = loadSession(input.session_id);
      if (session.googleRetryReason) {
        if (session.googleRetryReason === input.prompt) run = false;
        delete session.googleRetryReason;
        saveSession(input.session_id, session);
      }
    }
    if (event === 'PreInvocation' && run) {
      const session = loadSession(input.session_id);
      session.googleUserStep = input.turn_id;
      saveSession(input.session_id, session);
    }
    // Never force continuation after cancellation, errors or resource limits.
    if (provider === 'antigravity' && event === 'Stop' && raw.terminationReason !== 'NO_TOOL_CALL') run = false;
    if (provider === 'antigravity' && event === 'Stop' && run) {
      // PostToolUse can precede transcript persistence. Refresh only this turn's
      // command receipts, by exact step ID, once the final transcript is flushed.
      for (const receipt of antigravityReceiptRefreshes(input, rows, loadSession(input.session_id).hookResults ?? [])) onPost(receipt);
    }
    const output = run ? await handlers[event](input) : null;
    result = googleOutput(provider, event, output);
    if (provider === 'gemini-cli' && event === 'AfterAgent' && result.decision === 'deny') {
      const session = loadSession(input.session_id);
      session.googleRetryReason = result.reason;
      saveSession(input.session_id, session);
    }
    if (['PreToolUse', 'BeforeTool'].includes(event) && output?.hookSpecificOutput?.additionalContext) {
      const session = loadSession(input.session_id);
      session.googlePendingNotes = [...(session.googlePendingNotes ?? []), output.hookSpecificOutput.additionalContext].slice(-4);
      saveSession(input.session_id, session);
    }
    if (event === 'PreInvocation' || provider === 'gemini-cli' && event === 'AfterTool') {
      const session = loadSession(input.session_id);
      if (session.googlePendingNotes?.length) {
        const notes = session.googlePendingNotes.join('\n\n');
        if (provider === 'antigravity') result.injectSteps = [...(result.injectSteps ?? []), { ephemeralMessage: notes }];
        else result.hookSpecificOutput = { hookEventName: event, additionalContext: notes };
        session.googlePendingNotes = [];
        saveSession(input.session_id, session);
      }
    }
    log({ event: 'google-hook', provider, hook: event, sessionId: input.session_id, ran: run, output: Object.keys(result) });
  }
} catch (error) {
  log({ event: 'hook-error', hook: `${provider}:${event}`, sessionId: input?.session_id, error: String(error?.message ?? error).slice(0, 1000) });
}
process.stdout.write(JSON.stringify(result));
