# Writing lessons

A lesson is a check you add to Jevis: a yes/no question that a decision model (or code) answers about what the agent is doing, and what to do when the answer is yes. Use one when a fixed [tip](docs/tips.md) isn't enough because whether it applies depends on the content of a command, an edit, or a final message.

Each lesson is one Markdown file, `wiki/<area>/<name>.md`. Its id is the path without `wiki/` and `.md`, such as `verification/claim-contradicted`.

Jevis ships one lesson: `verification/claim-contradicted`, decided in code, which sends the agent back when its final message says checks pass while a check run after the last edit has failed on its latest run. Retired lessons live in `archive/` and are never loaded.

A lesson that code can't decide needs a [decision model](docs/configuration.md#the-decision-model), and each check sends the state listed under [What each event can read](#what-each-event-can-read) to it ([cost and privacy](docs/configuration.md#cost-and-privacy)). Commands here are written `jevis <command>`: run them as `node bin/jevis.mjs <command>` from your clone, or run `npm link` once to put `jevis` on your PATH.

## Where lessons live

Jevis loads three places in order, and a later one wins on the same id:

1. `wiki/` in this repository (shipped).
2. `~/.jevis/wiki/` (yours). `git pull` never touches it.
3. A repository's `.jevis/wiki/`, only inside that repository and only after `jevis trust <repo>`. Any change to those files needs trusting again.

In your own folder:

- A new id adds a lesson.
- The same id as a shipped lesson replaces it. Copy the shipped file across and edit the copy.
- A file whose frontmatter is only `off: true` turns the shipped lesson with that id off.

`JEVIS_WIKI` replaces all three with your own list of absolute folder paths (`:`-separated; `;` on Windows). `node bin/jevis.mjs lint` checks every lesson and lists what yours replaced or turned off. A broken replacement leaves the shipped lesson in force.

## A lesson

```markdown
---
event: tool
tools: [Bash]
when: { marks.plain_read: false }
ask: Does `input` publish a package to a public registry (npm publish, cargo publish, twine upload)?
yes: The command uploads a package release
no: A dry run, a pack without upload, or a command that only mentions publishing
unless: Does `request` ask to publish or release?
min: 0.85
action: context
title: Publishing a package
source: <where it came from: dates, counts, the user's own words>
---
Publishing can't be undone: the version number is burned even if you unpublish. Confirm the version and changelog first, and say in your reply that you published.
```

The body is what the agent reads when the lesson fires. Keep it under 900 characters: longer lessons fail lint and don't load.

| Field | Required | Meaning |
|---|---|---|
| `event` | yes | `tool` (before a command or edit) or `stop` (before the agent ends its turn; needs `decide`). |
| `ask` | yes | One literal yes/no question. Name the state fields it reads in backticks. |
| `yes`, `no` | no | What counts as yes and no. Put the boundary cases here. |
| `min` | no | The probability the answer must reach. Default 0.75. |
| `unless` | no | A second question that stands the lesson down when the answer is yes. |
| `unless_max` | no | The `unless` probability at or above which it stands down. Default 0.5. |
| `when` | no | Conditions that must also hold: axes (`visual: ">=0.6"`) or facts (`{ evidence.edited: true }`). Facts are checked before any model call. A missing fact fails its condition; an unknown (`null`) Bash effect or `em_dash` passes it, except `writes_file`. |
| `decide` | no | A code rule in `src/rules.mjs` that answers `ask` exactly. Today there is one: `claim_contradicted`. On a tool lesson, input the rule can't settle falls back to the model; on a stop lesson, it stands the lesson down. |
| `tools` | tool only | Tool names: `Bash`, `Edit`, `Write`, `MultiEdit`, `apply_patch` (Codex), `mcp__*`. `*` globs work. |
| `family` | no | `claude` or `gpt`, for a lesson about one family's habit. Models from other families get both. |
| `action` | yes | `context` adds the body to what the agent reads (tool). `block` sends the agent back (stop). |
| `title` | yes | A few words naming the lesson. |
| `source` | yes | Where it came from: dates, counts, the user's words. A lesson without evidence is an opinion. |

## How a lesson is decided

1. Lessons for the event and tool are collected, and any whose `when` facts already fail are dropped.
2. If a lesson has `decide`, code answers it. Otherwise its `ask` goes to the decision model, in parallel with the others. Stop never asks the model a lesson's `ask`: a stop lesson code can't settle stands down. A tool call with no lessons left makes no call.
3. A lesson fires when `ask` clears `min`, `unless` stays under `unless_max`, and every `when` condition holds. A model-decided lesson asks `unless` in a second call, only after clearing `min` and `when`; a code-decided match asks it in the first call.
4. A tool lesson's body is shown at most once per session (again after compaction). A stop lesson sends the agent back at most once per turn.

If the decision model fails or times out, every lesson that needed its answer stands down (a missing `unless` counts as applied). A code decision that needed nothing from it still acts. The agent is never held up by a failure.

## What each event can read

**tool**

- `request`: the user's current message. `earlier_requests`: up to 8 earlier messages, each cut to 400 characters, for permission given earlier.
- `tool`: the tool name.
- `input`: the command (up to 4,000 characters), or for an edit, the file path and only the lines it adds.
- `workspace`: `git` (is it a repository), `files` (up to 40 top-level names), `empty`.
- `marks`, facts code computes about `input`:
  - `plain_read`: a shell command that provably only reads (`ls`, `rg`, `sed -n`, `git log`, `gh pr view`), with no redirect, substitution, expansion, or credential. Gate every lesson about what a command does with `when: { marks.plain_read: false }`, so plain reads skip the model call. `lint` flags Bash lessons without it.
  - `git_write`, `writes_file`, `runs_tests`, `opens_app`, `uses_credentials`: `true` when explicit, `false` when provably not, `null` when unknown (scripts, expansions, clipped input).
  - `ran_before`: this session already ran this exact command.
  - `em_dash`: the input contains U+2014.

**stop**

- `request` and `final_message`.
- `evidence`, computed from the session since the turn began (subagents included):
  - `edited`, `files_changed` (up to 20), `files_changed_count`, `ui_files_changed`, `files_written_by_commands`;
  - `checks_after_last_edit`: test, build, or check commands after the last edit, with `success` and `exit_code`. An unknown or still-running result never counts as passing;
  - `actions_after_last_edit`, `recent_actions` (the last 12), `commands_run`, `used_subagents`.

## Axes

Axes are shared judgments, defined in `src/axes.mjs`, that a lesson can gate on with `when`.

- **tool:** `destructive` (could lose what can't easily be recovered), `outward` (sends or publishes something off this machine).
- **stop:** `work_requested`, `claims_done`, `claims_verified`, `visual`, `film`. These also decide whether the design review runs.

## Writing a good lesson

- **One failure per lesson.** Two failures fire under different conditions, so they're two lessons.
- **Make `ask` literal.** The model answers the words you wrote, not the ones you meant. If you'd need to explain what you meant, put that in `yes` and `no`. Keep counting and arithmetic out of questions; compute them in code as a fact.
- **Write the body for a capable colleague.** Name the failure, give the reason, say what to do instead, in two to six lines. Agents rightly distrust unexplained instructions injected mid-session.
- **The user's words win.** A body never overrides what the user asked for.
- **Keep stop lessons precise.** A wrong send-back costs more than a missed tip.
- **Test it.** `jevis ask --event tool --tool Bash --request "..." "<command>"` for single cases: at least one that should fire and two look-alikes that shouldn't. Then `jevis replay <session>` on real sessions. The hit should clear `min` comfortably and the look-alikes should sit under 0.5; if one lands near the line, reword `ask`, `yes`, and `no` rather than moving `min`.
- **Test on your decider.** Thresholds were tuned on Jev. GPT-6 Luna places the same case differently, so run your cases with `JEVIS_DECIDER=luna` if that's what you use. `jevis stats --near` shows how a lesson would have fired against every recorded answer.
