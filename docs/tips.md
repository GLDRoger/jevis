# Tips and hooks

## What happens at each moment

The harness calls `node bin/jevis.mjs hook <name>` at five points, passing JSON on stdin. Each call either adds short text to context or (at `Stop`) sends the agent back.

| Moment | Hook | What Jevis does |
| --- | --- | --- |
| Session starts, resumes, clears, or compacts | `SessionStart` (`PostCompact` too) | Injects `session` tips (session guide, judgment examples, model-family design defaults) — ~3.5 KB. `PostCompact` adds no text; it resets once-per-session tips and queues `check-in`. |
| You send a message | `UserPromptSubmit` | Injects `prompt` tips (~0.2 KB; ~0.5 KB for GPT) plus a `feedback` tip after short vague complaints. Records the request and turn number locally. |
| Before a command or edit | `PreToolUse` | Injects a moment tip when triggered (`search`, `repeat-failure`, `repeat-check`, `port-in-use`, `check-in`). Never alters or blocks the call. |
| After a tool runs | `PostToolUse` (and Claude's `PostToolUseFailure`) | Adds nothing. Logs exit codes, failures, edited files, and tool counts locally. |
| Before ending a turn | `Stop` | Sends the agent back (max once per turn) if it claims checks pass while a check run after the last edit failed. If that's clean and the [design review](configuration.md#the-design-review) is on, renders finished visual work and reviews it. |

Jevis never blocks a tool call, manages permissions, or filters output. Outside tips and that single pass-claim check, it only acts on [lessons](../WIKI.md) you add.

Preview what a hook outputs anytime:

```sh
echo '{"session_id":"try","model":"gpt-6.2-sol"}' | node bin/jevis.mjs hook session
```

## The tips

Each tip is a Markdown file in [`nudges/`](../nudges/). Frontmatter sets when it fires (`hook:`) and optionally which model family sees it (`family: claude`, `gpt`, or `other`). Bodies cap at 1,500 characters. Pure local code picks them — zero model calls, zero network.

| `hook:` | When it fires | Shipped tips |
| --- | --- | --- |
| `session` | Session start, resume, clear, and compaction-restarts | `base-session.md`, `base-session-judgment.md`, `design-base.md`, plus one of `design-claude.md`, `design-gpt.md`, or `design-other.md` |
| `prompt` | Every message | `base-prompt-copy.md` (UI copy), `base-prompt-web.md` (check the web for a better approach), and `gpt-prompt.md` for GPT |
| `feedback` | Short vague pushback ("not good", "try again") — ≤8 words, not a question | `base-feedback.md` |
| `feedback-repeat` | Second and later vague pushback in a session | `base-feedback-repeat.md` |
| `worker` | Every message in a worker session (replaces `prompt` tips) | none shipped; add your own |
| `search` | First `grep` or `find` command (resets after compaction) | `base-search.md` |
| `repeat-failure` | Re-running a command whose last two runs failed (once per command) | `base-repeat-failure.md` |
| `repeat-check` | Re-running a test/build with no file edit in between (shell edits aren't tracked) | `base-repeat-check.md` |
| `port-in-use` | Next tool call after a port-conflict failure | `base-port-in-use.md` |
| `check-in` | Every 20th tool result since your last message, and first tool call after compaction (skipped for workers) | `base-check-in.md` |
| `ui-edit` | First UI file edit in a turn | none shipped; add your own |

Design tips go out at session start so they shape the first file written; each family's list of generated-looking tells comes straight from my own logs. Shipped tips reflect my setup (like `rg` and `fd` being installed) — swap or disable anything that doesn't fit yours.

## Changing tips

Put overrides in `~/.jevis/nudges/` so `git pull` never clobbers them. Changes take effect on the next hook call:

- **Edit a tip:** copy `nudges/<name>.md` to `~/.jevis/nudges/<name>.md` and change it.
- **Disable a tip:** put `off: true` in that copy's frontmatter (or set `JEVIS_NUDGES=off` to kill all tips).
- **Add a tip:** drop a new `.md` file in `~/.jevis/nudges/` with any `hook:` above.
- **Validate:** `npm run lint` catches broken frontmatter or empty bodies.

If firing depends on what a command or edit actually contains, write a [lesson](../WIKI.md) instead. You can also hand changes to an agent via [`skills/jevis/SKILL.md`](../skills/jevis/SKILL.md):

```text
Read ~/code/jevis/skills/jevis/SKILL.md, then add a tip that tells the agent to run the linter before committing.
```

A tip only earns its context if it changes behavior at that moment. Keep it consistent with your instruction files, and kill anything models already do on their own ([Evidence](evidence.md)).

## Worker sessions

Jevis treats a session as a worker when it sees any of:
- `"You were called by another agent. Do this task yourself."` in the first prompt (`JEVIS_WORKER_MARKER` overrides it);
- a leading `[agent]` bracket tag;
- `AGENT_CALL_DEPTH > 0` in the environment.

Workers keep `session` tips and get `worker` tips instead of `prompt` tips. They skip feedback tips, design reviews, and all decision-model calls. Their rows in `log.jsonl` carry `worker: true`.

## Fails open

Missing key, timeout, corrupt config, or moved checkout — Jevis gets out of the way and lets the agent keep working. Run `node bin/jevis.mjs doctor` to check what's actually active.
