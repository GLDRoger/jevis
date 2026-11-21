# Other harnesses

The installer handles Claude Code and Codex. Wire any other harness by hand below.

## Claude Code and Codex (manual)

Claude Code reads `hooks` in `~/.claude/settings.json`; Codex reads `~/.codex/hooks.json` (Codex treats `apply_patch` like `Edit`/`Write`).

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

In Claude Code, also add the `hook post` entry under `PostToolUseFailure` with the same matcher.

## Muse Code

Put the same block in `~/.config/muse/settings.json`, changing the tool matcher to `^(bash|edit_file|write_file|apply_patch|mcp__.*)$`.

## Gemini CLI and Antigravity CLI

Both go through the `bin/google-hook.mjs` adapter. Replace `<repo>` with your absolute checkout path and merge into your existing config (don't overwrite Beast's `context.fileName` in `~/.gemini/settings.json`). Note: Gemini CLI timeouts are in **ms**; Antigravity's are in **seconds**.

**Gemini CLI** (`hooks` in `~/.gemini/settings.json`):

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

**Antigravity CLI** (`~/.gemini/config/hooks.json` or `.agents/hooks.json`, no outer `hooks` key):

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

Check what loaded with `/hooks panel` (Gemini) or `/hooks` (Antigravity).

If you run Antigravity inside **T3 Code**, T3 sets `GEMINI_HOME` to `~/.t3/userdata/providers/antigravity/<id>`, so symlink `~/.gemini/config/hooks.json` into `~/.t3/userdata/providers/antigravity/<id>/config/hooks.json` as well.

## Adding another harness

Anything speaking the same JSON-on-stdin hook contract works out of the box. Otherwise add a small adapter in `src/context.mjs` (`harnessOf` + transcript reader) and `src/hooks.mjs` (output shape).

## Codex plugin

Jevis also ships as a Codex plugin (`plugin.json`, `hooks/hooks.json`, `.agents/plugins/`). Use **either** the plugin or the installer for Codex, never both (otherwise every hook fires twice):

```sh
node bin/install.mjs --harness codex --uninstall
codex plugin marketplace add ~/code/jevis
codex plugin add jevis@jevis-local
```

Then run `/hooks` in a new Codex session and trust Jevis's six hooks. `doctor` doesn't detect plugin installs — check `node bin/jevis.mjs stats` instead. Plugin quoting is macOS/Linux only; use the installer on Windows.

## Windows

The installer works across Git Bash, Windows PowerShell 5.1, PowerShell 7, and cmd. Install Node in a path without spaces (otherwise it falls back to `node` on PATH and `doctor` warns). CI runs the full suite on Windows, Linux, and macOS. On Windows, the design review can't auto-discover running dev servers, so it renders localhost URLs mentioned in the turn or changed HTML files instead.
