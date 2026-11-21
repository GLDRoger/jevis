# Writing lessons

A **lesson** is a content-aware check: a yes/no question answered by code or a decision model about what the agent is about to do, plus a short note (or stop) if the answer is yes. Reach for a lesson only when a fixed [tip](docs/tips.md) isn't specific enough.

Each lesson is a Markdown file at `wiki/<area>/<name>.md` (id = `<area>/<name>`). Jevis ships one lesson: `verification/claim-contradicted`, decided purely in code, which catches agents claiming tests passed after a failed check. Old v1 lessons sit unloaded in `archive/`.

Lessons that code can't settle need a [decision model](docs/configuration.md#the-decision-model) and send the fields listed under [What each event can read](#what-each-event-can-read) ([cost and privacy](docs/configuration.md#cost-and-privacy)). Below, `jevis` means `node bin/jevis.mjs` (or run `npm link` once).

## Where lessons live

Loaded in order, later wins on the same id:
1. `wiki/` in this repo (shipped).
2. `~/.jevis/wiki/` (yours — untouched by `git pull`).
3. `<repo>/.jevis/wiki/` (per-repo, only after `jevis trust <repo>`; re-trust after edits).

In `~/.jevis/wiki/`: add a new id to create a lesson, copy a shipped id to override it, or put only `off: true` in frontmatter to disable a shipped lesson. `JEVIS_WIKI` overrides all three (`:`-separated; `;` on Windows). Run `node bin/jevis.mjs lint` to check everything.

## Lesson format

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
source: <dates, counts, or exact quote that motivated it>
---
Publishing can't be undone: the version number is burned even if you unpublish. Confirm the version and changelog first, and say in your reply that you published.
```

Keep the body under 900 characters (longer lessons fail lint and won't load).

| Field | Req | Meaning |
| --- | --- | --- |
| `event` | yes | `tool` (before command/edit) or `stop` (before turn ends; requires `decide`) |
| `ask` | yes | Literal yes/no question referencing state fields in backticks |
| `yes`, `no` | no | Concrete boundary examples |
| `min` | no | Confidence threshold (default `0.75`) |
| `unless` | no | Stand-down question (e.g. did the user ask for this?) |
| `unless_max` | no | Stand-down threshold (default `0.5`) |
| `when` | no | Pre-filter on axes (`visual: ">=0.6"`) or facts (`{ evidence.edited: true }`). Facts run before any model call; unknown (`null`) Bash marks pass except `writes_file`. |
| `decide` | no | Code rule in `src/rules.mjs` (currently `claim_contradicted`). Tool lessons fall back to the model if unsettled; stop lessons stand down. |
| `tools` | tool | Tool names/globs: `Bash`, `Edit`, `Write`, `MultiEdit`, `apply_patch`, `mcp__*` |
| `family` | no | `claude` or `gpt` (other models get both) |
| `action` | yes | `context` (inject body on tool) or `block` (send back on stop) |
| `title` | yes | Short lesson name |
| `source` | yes | Concrete evidence (dates, counts, quotes) |

## Evaluation flow

1. Match lessons by event/tool and drop any whose `when` facts fail.
2. Run `decide` in code if present; otherwise query the decision model in parallel. Stop never queries the model for `ask`.
3. Fire when `ask >= min`, `unless < unless_max`, and all `when` conditions pass.
4. Tool lessons fire at most once per session (reset on compaction). Stop lessons block at most once per turn.

Timeouts or API errors always fail open — any lesson that needed the model stands down.

## What each event can read

**`tool`**
- `request` (current user message) and `earlier_requests` (up to 8 prior messages, 400 chars each).
- `tool` name and `input` (command up to 4,000 chars, or edit file path + added lines).
- `workspace`: `git`, `files` (up to 40 top-level names), `empty`.
- `marks` (computed in code):
  - `plain_read`: provably read-only shell command (`ls`, `rg`, `sed -n`, `git log`, `gh pr view`). Always gate Bash lessons with `when: { marks.plain_read: false }` so reads skip model calls (`lint` warns if missing).
  - `git_write`, `writes_file`, `runs_tests`, `opens_app`, `uses_credentials`: `true`, `false`, or `null` (unknown).
  - `ran_before`, `em_dash`.

**`stop`**
- `request`, `final_message`.
- `evidence` since turn start (including subagents): `edited`, `files_changed` (≤20), `files_changed_count`, `ui_files_changed`, `files_written_by_commands`, `checks_after_last_edit` (`success` + `exit_code`; unknown/running never counts as passing), `actions_after_last_edit`, `recent_actions` (last 12), `commands_run`, `used_subagents`.

## Axes

Shared scores in `src/axes.mjs` usable in `when`:
- **tool:** `destructive`, `outward`
- **stop:** `work_requested`, `claims_done`, `claims_verified`, `visual`, `film` (also gates the design review)

## Writing good lessons

- **One failure per lesson.** Don't bundle unrelated triggers.
- **Keep `ask` literal.** Put edge cases in `yes`/`no`; compute counts in code.
- **Write like a colleague.** Name what's wrong, why, and what to do in 2–6 lines. Never override the user's explicit request.
- **Be extra strict on `stop`.** A false send-back is far more annoying than a missed tip.
- **Test before keeping:** run `jevis ask --event tool --tool Bash --request "..." "<command>"` on one true positive and two look-alike negatives, then `jevis replay <session>` on real transcripts. True hits should clear `min` cleanly and look-alikes should sit under 0.5 — fix the wording instead of tweaking `min`. Test on `JEVIS_DECIDER=luna` if you run Luna, and check `jevis stats --near`.
