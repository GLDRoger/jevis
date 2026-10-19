---
name: jevis-improve
description: Review what Jevis has been doing from its own records and the user's agent transcripts, then propose changes as a diff for the user to review. Covers cost, what each check caught or got wrong, and the user's repeated corrections. Use weekly, the day after any change to Jevis or its lessons, or when the user asks whether Jevis is worth running.
---

# Improving Jevis from its history

Jevis keeps everything it does on disk as plain JSON lines. Read those files directly and answer three questions:

1. **What does it cost?** Count model calls and tokens, by day and by hook.
2. **Is it helping?** For each check that acted, decide whether the user was better off.
3. **What does the user keep correcting?** Look for habits that repeat across sessions, which belong in the user's instruction files.

You write **proposals only**. Never edit the user's instruction files, Jevis's config, or any wiki entry. Write a report and a diff; the user decides what to apply.

## Where the history lives

`$JEVIS_HOME` defaults to `~/.jevis`. Everything there is private to the user and contains their prompts.

| Path | What it holds | Size |
|---|---|---|
| `~/.jevis/log.jsonl` | One row per hook decision: `prompt`, `tool`, `stop`, `review`, `session`, `hook-error` | tens of MB |
| `~/.jevis/jev/calls.jsonl` | One row per decision-model call: full state, answers, token `usage`, `ms`. Missing when `JEVIS_RECORD=off` | hundreds of MB |
| `~/.jevis/jev/questions/<hash>.json` | The question sets those calls asked, keyed by hash | small |
| `~/.jevis/sessions/<id>.json` | Per-session memory: current request, turn, notes shown, worker status | small each |
| `~/.jevis/reviews/<session>/turn<N>-round<M>/` | Design-review renders and verdicts | images |
| `~/.jevis/wiki/` | The user's own lessons, which override the shipped `wiki/` by id | small |
| `<repo>/nudges/`, `~/.jevis/nudges/` | Tips: fixed lines of context, one Markdown file each; a user file replaces the shipped one with the same name | small |
| `~/.jevis/config.json` | Settings (`JEVIS_DECIDER`, `JEVIS_CRITIC`, prices, …) | tiny |
| `<repo>/wiki/`, `<repo>/archive/wiki-v1/` | Shipped lessons, and the v1 lessons retired in October 2026 with the reason | small |
| `~/.claude/projects/<dir>/<session>.jsonl` | Claude Code transcripts. Typed user messages are rows with `type=="user"` whose `.message.content` is a string | large |
| `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | Codex transcripts. User messages are rows with `type=="response_item"` and `.payload.role=="user"`, with text in `.payload.content[].text` | large |

The instruction files that steer the user's agents, which your proposals target:

- `~/.claude/CLAUDE.md` (Claude Code)
- `~/.codex/AGENTS.md` (Codex)
- `~/.agents/AGENTS.md` (shared)
- `AGENTS.md` / `CLAUDE.md` in a repository, for project habits

### Row shapes in `log.jsonl`

- `tool`: `sessionId, harness, turn, tool, input` (clipped to 200 characters), `ms`, `pool` (entries asked), `fired[{id,p}]`, `acted[ids]`, `mode`. A row with `skipped` made no model call.
- `stop`: `final` (clipped), `evidence{edited,files,ui_files,after}`, `fired`, `acted` (checks that blocked).
- `prompt`: `request` (clipped), `origin` (`person` or an agent), `turn`. Since v2 it makes no model call.
- `review`: `verdict`, `items`, `ms`, `error`.
- `nudge`: `hook` (any `hook:` value from the table in docs/tips.md, such as `session`, `prompt`, `feedback`, `repeat-failure`), `ids` (the tip files sent), `model`, `turn`. A tip from `nudges/` was added to the agent's context. No model call.

Worker sessions carry `worker: true` on prompt, tool and Stop rows. Their tool rows have `skipped: "worker"`; they make no decision-model or critic calls.

A `calls.jsonl` row has `at, event, sessionId, harness, model, decider, deciderModel, ms, state, answers, usage{input_tokens,output_tokens}, error`.

## Rules for working with this data

- **Keep commands bounded.** These files are large. Stream them: use `rg '"event":"tool"' file | jq …`, `tail -n`, or `--since`. Never `cat` them or load them whole. Pipe to `head`, or summarise with `sort | uniq -c`.
- **Don't spend money to measure.** `jevis ask` and `jevis replay` call the decision model, so run them only if the user asks. Everything below reads what is already recorded.
- **Treat it as private.** Quote at most a sentence of any prompt, keep the report under `~/.jevis/`, never in a repository.
- **Count before you conclude.** Every claim in the report carries its number and date range, and every example carries its session id and timestamp.

## 1. Cost

Run `node <jevis repo>/bin/jevis.mjs cost --since 7d`. It prints calls and tokens per day and per hook, plus a 30-day projection. Prices appear when `JEVIS_PRICE_IN` and `JEVIS_PRICE_OUT` (USD per million tokens) are set in the config.

Then find what drives the cost:

```sh
# Model calls per tool, last 7 days (rows without "skipped" made a call)
rg '"event":"tool"' ~/.jevis/log.jsonl | jq -r --arg s "$(date -u -v-7d +%FT%T)" 'select(.at > $s and .skipped == null) | .tool' | sort | uniq -c | sort -rn | head
# Entries asked per call: a large pool means a large prompt
rg '"event":"tool"' ~/.jevis/log.jsonl | tail -n 2000 | jq -r 'select(.pool) | .pool' | sort -n | uniq -c | tail
```

**Flag:** any hook or tool that makes many calls while its checks rarely act. The October 2026 audit found that prompt notes and model-judged stop blocks cost most of the $70 and changed almost nothing.

## 2. Did each check help?

List what acted:

```sh
rg '"acted":\["' ~/.jevis/log.jsonl | jq -r 'select(.mode=="live") | "\(.at[0:10]) \(.event) \(.acted|join(","))"' | awk '{print $2, $3}' | sort | uniq -c | sort -rn
```

For each check that acted, sample up to 10 cases. Open the session's transcript around that timestamp and judge each case:

- **Helped:** the agent changed course, and the user never pushed back. For example, it fixed a failing test before claiming success.
- **Harmed:** the user overrode it, repeated the request, or said it was wrong.
- **Neutral:** nothing changed, or the agent would have done the same anyway because its instruction files already say so.

Also check what never acted:

```sh
ls <jevis repo>/wiki/*/*.md ~/.jevis/wiki/*/*.md   # then compare ids against the acted counts above
```

Judge tips (`nudge` rows) the same way: for a sample of each tip, read what the agent did right after it. A tip that never changes the next action is noise and costs context on every send; propose `off: true` or a rewrite. For `feedback` tips, also check the user's next message: a second vague correction right after means the tip didn't help. Look for vague feedback the code missed too: short dissatisfied messages with no `feedback` row in the same turn.

A check that acted zero times in 30 days and costs a model call is a candidate for removal. One decided in code (`decide:` in its frontmatter) costs nothing and can stay.

## 3. What does the user keep correcting?

Read the user's own messages in the transcripts for the period. Skip injected text: lines starting with `<environment_context>`, `<task-notification>`, `# AGENTS.md instructions`, `<command-`, `Caveat:`, `Context handoff`, and messages that open with "You were called by another agent".

```sh
# Claude Code: typed user messages since a date
rg -l --glob '*.jsonl' '"type":"user"' ~/.claude/projects --sortr modified | head -50 \
  | xargs -I{} jq -r 'select(.type=="user" and (.message.content|type)=="string" and .timestamp > "2026-10-12") | "\(.timestamp[0:16]) \(.message.content[0:300]|gsub("\n";" "))"' {} 2>/dev/null \
  | rg -v '^\S+ (<environment_context>|<task-notification>|<command-|Caveat:|Context handoff|You were called by another agent)'
# Codex
fd -e jsonl . ~/.codex/sessions/2026/10 --changed-within 7d \
  | xargs -I{} jq -r 'select(.type=="response_item" and .payload.role=="user") | .payload.content[]?.text? // empty | .[0:300] | gsub("\n";" ")' {} 2>/dev/null \
  | rg -v '^(<environment_context>|<task-notification>|# AGENTS.md|Context handoff|You were called by another agent)'
```

Look for corrections: "no", "that's not what I asked", "stop doing X", "I told you", "again", a repeated instruction, or a complaint about a window, sound, cost, tone, or scope. For each one, read the agent turn before it to see what went wrong.

**A habit is a lesson only when it repeats:** at least 3 times across at least 2 sessions. One annoyed message is not a lesson. For each habit, check first whether the instruction files already cover it. If they do, the gap is in the agent rather than the instructions. Report it, and propose a wording change only if the current text is ambiguous.

Decide where each fix belongs, cheapest first:

1. **An instruction-file line** (CLAUDE.md, AGENTS.md). It costs nothing at runtime, and every agent reads it. This is the default.
2. **A code-decided Jevis check** (`decide:` in `src/rules.mjs`). Keep the code-decided pass-claim Stop check precise; tool checks can only add context. There's no model call.
3. **A model-judged Jevis check.** Use it only with evidence that the first two can't catch the problem and that it happened often enough to pay for a call on every matching tool use. Estimate that cost from section 1.

## 4. Write the proposal

Create `~/.jevis/proposals/<YYYY-MM-DD>/` with two files.

**`report.md`**, short:

- **Period and volume:** dates, sessions, model calls, tokens, and dollars if prices are set.
- **Checks:** a table with one row per check: acted N, helped / harmed / neutral from your sample, and keep, retune, move to code, or remove.
- **Habits:** each with its count, two dated quotes, and the proposed line.
- **Verdict:** is Jevis paying for itself this period? Give one paragraph with the numbers behind it.

**`changes.diff`**, a unified diff the user can read and apply with `patch -p0 < changes.diff`:

```sh
cp ~/.claude/CLAUDE.md /tmp/CLAUDE.md.proposed   # edit the copy, never the original
diff -u ~/.claude/CLAUDE.md /tmp/CLAUDE.md.proposed >> ~/.jevis/proposals/<date>/changes.diff
```

Put a wiki change in the same diff: an `off: true` file under `~/.jevis/wiki/<id>.md`, a reworded `ask`, or a new entry written as `WIKI.md` describes. Changes to Jevis's own code go in the report as a recommendation, not the diff.

Finish by telling the user where the two files are and summarising the verdict in a few lines. Don't apply anything.

## When to run this

- **The day after any change** to Jevis, its config, or a lesson. One day of data is enough to catch a cost spike. Don't wait a month.
- **Weekly** after that. Compare with the previous `~/.jevis/proposals/` report, and say what changed since then and whether earlier proposals were applied and helped.
