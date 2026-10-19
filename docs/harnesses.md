# Other harnesses

The installer handles Claude Code and Codex. For anything else, add the hooks by hand.

## Claude Code and Codex, by hand

Claude Code reads the `hooks` key of `~/.claude/settings.json`; Codex reads `~/.codex/hooks.json`. Codex treats `apply_patch` as `Edit`/`Write`.

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "node ~/code/jevis/bin/jevis.mjs hook session", "timeout": 10 }] }],
    "PostCompact": [{ "hooks": [{ "type": "command", "command": "node ~/code/jevis/bin/jevis.mjs hook session", "timeout": 10 }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "node ~/code/jevis/bin/jevis.mjs hook prompt", "timeout": 10 }] }],
    "PreToolUse": [{ "matcher": "^(Bash|Edit|Write|MultiEdit|NotebookEdit|mcp__.*)$", "hooks": [{ "type": "command", "command": "node ~/code/jevis/bin/jevis.mjs hook tool", "timeout": 10 }] }],
    "PostToolUse": [{ "matcher": "^(Bash|Edit|Write|MultiEdit|NotebookEdit|mcp__.*)$", "hooks": [{ "type": "command", "command": "node ~/code/jevis/bin/jevis.mjs hook post", "timeout": 10 }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "node ~/code/jevis/bin/jevis.mjs hook stop", "timeout": 420 }] }]
  }
}
```

Claude Code also takes the `hook post` command under `PostToolUseFailure`, with the same matcher.

## Muse Code

Muse Code sends the same hook payloads with its own tool names. Use the commands above in `~/.config/muse/settings.json`, with the tool matcher `^(bash|edit_file|write_file|apply_patch|mcp__.*)$`.

## Gemini CLI and Antigravity CLI

These use an adapter, `bin/google-hook.mjs`. Replace `<repo>` with the absolute path to your checkout, and merge these into your existing config. Gemini CLI timeouts are in milliseconds; Antigravity's are in seconds.

Gemini CLI, under `hooks` in `~/.gemini/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "node \"<repo>/bin/google-hook.mjs\" gemini-cli SessionStart", "timeout": 10000 }] }],
    "BeforeAgent": [{ "hooks": [{ "type": "command", "command": "node \"<repo>/bin/google-hook.mjs\" gemini-cli BeforeAgent", "timeout": 10000 }] }],
    "BeforeTool": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "node \"<repo>/bin/google-hook.mjs\" gemini-cli BeforeTool", "timeout": 10000 }] }],
    "AfterTool": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "node \"<repo>/bin/google-hook.mjs\" gemini-cli AfterTool", "timeout": 10000 }] }],
    "AfterAgent": [{ "hooks": [{ "type": "command", "command": "node \"<repo>/bin/google-hook.mjs\" gemini-cli AfterAgent", "timeout": 420000 }] }]
  }
}
```

Antigravity CLI, in `~/.gemini/config/hooks.json` (or `.agents/hooks.json` for one workspace). This file has no `hooks` wrapper:

```json
{
  "jevis": {
    "SessionStart": [{ "type": "command", "command": "node \"<repo>/bin/google-hook.mjs\" antigravity SessionStart", "timeout": 10 }],
    "PreInvocation": [{ "type": "command", "command": "node \"<repo>/bin/google-hook.mjs\" antigravity PreInvocation", "timeout": 10 }],
    "PreToolUse": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "node \"<repo>/bin/google-hook.mjs\" antigravity PreToolUse", "timeout": 10 }] }],
    "PostToolUse": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "node \"<repo>/bin/google-hook.mjs\" antigravity PostToolUse", "timeout": 10 }] }],
    "Stop": [{ "type": "command", "command": "node \"<repo>/bin/google-hook.mjs\" antigravity Stop", "timeout": 420 }]
  }
}
```

These adapters have protocol tests but haven't been tried in live authenticated sessions. `/hooks panel` (Gemini) and `/hooks` (Antigravity) show what loaded.

## A new harness

A harness that speaks the same JSON-on-stdin protocol should work as is. One with a different protocol needs an adapter in `src/context.mjs` (`harnessOf` and the transcript reader) and `src/hooks.mjs` (output format).

## The Codex plugin

This repository is also a Codex plugin (`plugin.json`, `hooks/hooks.json`, marketplace in `.agents/plugins/`). It calls the same CLI. Use it *instead of* the installer for Codex, never both, or every hook runs twice:

```sh
node bin/install.mjs --harness codex --uninstall   # if you installed the standard way first
codex plugin marketplace add ~/code/jevis
codex plugin add jevis@jevis-local
```

Then open `/hooks` in a new Codex session and trust Jevis's six hooks. `doctor` doesn't check plugin installs; `jevis stats` shows whether they're firing. The plugin's commands are quoted for macOS and Linux only, so use the installer on Windows.

## Windows

The installer writes commands that work in Git Bash, Windows PowerShell 5.1, PowerShell 7, and cmd. Install Node in a folder without spaces: otherwise it may fall back to `node` on PATH, and `doctor` warns about that. CI runs every hook through each of these shells, but nobody has run a live Claude Code or Codex session on Windows or Linux yet. On Windows the design review can't discover a running dev server, so it reviews a localhost URL mentioned in the turn, or else the changed HTML files.
