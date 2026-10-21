# Tips and hooks

## What happens at each moment

The harness calls Jevis at five moments. Each call is a short-lived `node bin/jevis.mjs hook <name>` process that reads JSON on stdin and, at most, adds text to the agent's context or sends the agent back.

| Moment | Hook | What Jevis does |
|---|---|---|
| A session starts, resumes, is cleared, or is compacted | `SessionStart` (`PostCompact` too) | Adds the `session` tips: the session guide, judgment examples, and design reminders for that model's family. About 3.5 KB. `PostCompact` adds no text; it only lets once-per-session tips show again. |
| You send a message | `UserPromptSubmit` | Adds the `prompt` tips, about 0.7 KB (about 1 KB for GPT models), plus a `feedback` tip after short, vague feedback. It also records the request and turn number for the other hooks. |
| The agent is about to run a command or edit | `PreToolUse` | Adds a tip only when one fits the moment (`search`, `repeat-failure`, `repeat-check`, `port-in-use`). The call itself is never changed or refused. |
| A tool finishes | `PostToolUse` (and Claude Code's `PostToolUseFailure`) | Adds nothing. Records exit codes, failures, and changed files, locally. |
| The agent is about to end its turn | `Stop` | Sends the agent back, at most once a turn, if its final message says checks pass while any check run after the last edit failed on its latest run. Code decides this from the turn's recorded exit codes. If that check doesn't fire and the [design review](configuration.md#the-design-review) is on, finished visual work is rendered and reviewed. |

Jevis never refuses a tool call or an edit, never manages permissions, and never filters anything. Beyond the tips and that one check, it acts only on [lessons](../WIKI.md) you add.

To see exactly what a hook sends, run it by hand:

```sh
echo '{"session_id":"try","model":"gpt-6-sol"}' | node bin/jevis.mjs hook session
```

## The tips

A tip is one Markdown file in [`nudges/`](../nudges/). Its frontmatter says when the tip is shown (`hook:`) and, optionally, which model family sees it: `family: claude`, `gpt`, or `other`, meaning every model outside those two. The body is what the agent reads, cut at 1,500 characters. Code picks the tips: no model is asked, and Jevis makes no network call. The chosen text joins the agent's context like any other.

| `hook:` | When it shows | Shipped tips |
|---|---|---|
| `session` | Session start, resume, and clear, and after a compaction the harness reports as a session start (Claude Code does) | `base-session.md` (the session guide), `base-session-judgment.md` (judgment examples), `design-base.md`, plus one of `design-claude.md`, `design-gpt.md`, or `design-other.md` |
| `prompt` | Every message | `base-prompt.md` (a short reminder of the guide), `base-prompt-copy.md` (interface copy), and `gpt-prompt.md` for GPT models |
| `feedback` | Short, vague feedback such as "not good" or "try again". The whole message must be the complaint: eight words or fewer, and not a question. | `base-feedback.md` |
| `feedback-repeat` | The second and later vague feedback in a session | `base-feedback-repeat.md` |
| `worker` | Every message in a session started by another agent, instead of the `prompt` tips | `base-worker.md` |
| `search` | The first `grep` or `find` command, and again after a compaction | `base-search.md` |
| `repeat-failure` | A command about to run again after its last two runs failed (once per command) | `base-repeat-failure.md` |
| `repeat-check` | A test or build about to rerun with no edit since the last run. Edits made by shell commands aren't tracked. | `base-repeat-check.md` |
| `port-in-use` | The next tool call after one failed because a port was taken | `base-port-in-use.md` |
| `ui-edit` | The first interface edit of a turn | none; available for your own |

The design tips go out at session start so that they reach the first file the agent writes. Each family's list of generated-looking defaults comes from the maintainer's own logs.

The shipped tips carry the maintainer's preferences. For example, `base-prompt.md` asks for bold, ambitious work, and `base-search.md` assumes `rg` and `fd` are installed. Change or switch off any tip that doesn't fit you.

## Changing tips

Your changes live in `~/.jevis/nudges/`, so `git pull` never touches them. They take effect at the next hook call.

- **Change a tip:** copy it from `nudges/` to `~/.jevis/nudges/` under the same name, and edit the copy. It replaces the shipped file.
- **Switch a tip off:** put `off: true` in the copy's frontmatter. `JEVIS_NUDGES=off` switches every tip off.
- **Add a tip:** create a new file in `~/.jevis/nudges/` with one of the `hook:` values above.
- **Check them:** `npm run lint` reports any tip that doesn't load.

For checks that depend on what a command or message contains, write a [lesson](../WIKI.md) instead. Lessons need a decision model.

You can also have your agent make the change. [`skills/jevis/SKILL.md`](../skills/jevis/SKILL.md) teaches a coding agent how to change Jevis and check the change:

```text
Read ~/code/jevis/skills/jevis/SKILL.md, then add a tip that tells the agent to run the linter before committing.
```

A tip earns its place only if it changes what the model does at the moment it shows. It may restate a rule from the agent's instruction files in fewer words, but it must never add a rule those files would contradict. Tips that only repeat what models already do are noise on every send. [Evidence](evidence.md) covers what is and isn't known about whether the current tips change behaviour.

## Worker sessions

A session started by another agent is a worker session. Jevis recognises one by any of these signs:

- the phrase "You were called by another agent. Do this task yourself." in the first prompt (case-insensitive; `JEVIS_WORKER_MARKER` changes it);
- a prompt that starts with a bracketed agent tag, such as `[agent]` or `[broker-job]`;
- `AGENT_CALL_DEPTH` above 0, or `BROKER_JOB_ID` or `BROKER_DEPTH` set, in the environment.

Workers keep the session tips and get the worker tip on every message: no one can answer questions, so make the call and list assumptions. They get no feedback tips, no design review, and no decision-model or other external calls. Their log rows carry `worker: true`.

## It fails open

With no key, a timeout, a broken settings file, or a moved checkout, the agent carries on as if Jevis weren't there. `node bin/jevis.mjs doctor` tells that apart from "nothing applied".
