---
name: jevis
description: Change what Jevis does for your coding agents. Add, tune, replace, or turn off a lesson, a design telltale (slop) refusal, a tool refusal, a stop check, or your design law, and prove the change works. Use when the user wants Jevis to notice, say, refuse, or check something new, or to stop doing something.
---

# Changing Jevis

Jevis is a set of agent hooks. At three moments it asks a decision model yes/no questions about what is happening, then acts on the answers:
- `prompt`: the user sent a message;
- `tool`: the agent is about to run a command or make an edit;
- `stop`: the agent is about to end its turn.

Almost every behavior is a **wiki entry**: one Markdown file holding one question and what to do when the answer is yes. Reach for code only when no entry can express the change.

Paths below are relative to the Jevis repo, two folders above this file. `jevis` means `node bin/jevis.mjs`, run from the repo.

## 1. Pin down the behavior

Restate the user's wish as one sentence: "At <moment>, when <something visible in the state>, Jevis should <tell the agent | refuse | send it back>." If the user gave a vague wish ("stop Codex making cheap-looking buttons"), name the concrete pattern and one example that must *not* trigger it, and confirm both with the user when the boundary is unclear.

Then find the row:

| The user wants Jevis to… | Change | Where |
|---|---|---|
| tell the agent something when a kind of request arrives | a `prompt` entry, `action: context` | `~/.jevis/wiki/<area>/<name>.md` |
| remind the agent of something as it runs a command or edits | a `tool` entry, `action: context` | `~/.jevis/wiki/<area>/<name>.md` |
| refuse a command (destructive, outward, wasteful) | a `tool` entry, `action: deny` | `~/.jevis/wiki/<area>/<name>.md` |
| refuse an edit that adds a design telltale | a `tool` entry, `action: deny` | `~/.jevis/wiki/slop/<name>.md` |
| keep the agent from finishing until it has checked, tested, or finished the list | a `stop` entry, `action: block` | `~/.jevis/wiki/<area>/<name>.md` |
| design to the user's own rules | the design law file | `~/.jevis/design-law.md` |
| soften, retarget, or rewrite a shipped lesson | a copy with the same id | `~/.jevis/wiki/<same id>.md` |
| drop a shipped lesson | a file whose frontmatter is only `off: true` | `~/.jevis/wiki/<same id>.md` |
| turn on the shipped optional safety entries | configuration | `JEVIS_ENABLE` (README, Configuration) |
| use another decision model, act only in some folders, go quiet, change the reviewer | configuration | README, Configuration |
| judge a fact the state doesn't carry, such as a count or an exact character | code: compute it as a fact | `src/context.mjs` or `src/hooks.mjs`, then WIKI.md, "The state Jev reads" |
| gate many entries on one new shared question | code: a new axis | `src/axes.mjs`, then WIKI.md, "Axes" |
| change how pages or films are reviewed when a turn ends | code | `src/review.mjs` (`criticPrompt`, `REVIEW_ROUNDS`) |

`~/.jevis/wiki/` is the user's own wiki. It loads after the shipped `wiki/`, survives `git pull`, and wins on a shared id. Edit the repo's `wiki/` only when the change is meant for every Jevis user, as a contribution.

## 2. Write the entry

Read `WIKI.md` in full first. It defines every field, the state each moment sees, the axes, and the conditions. The steps below are the judgment it asks for.

1. **Check what exists.** List `wiki/*/` and `~/.jevis/wiki/*/` and read any entry near the new behavior. If one covers it, replace that entry by id instead of adding a second that fires alongside it.
2. **Choose the moment by where the evidence is.** A `prompt` entry sees the request. A `tool` entry sees the command, or only the lines an edit adds. A `stop` entry sees the final message and facts about what the turn did (`evidence.*`).
3. **Ask one literal question.** Name the state field in backticks. Describe the pattern the way code or a command would spell it (`background-clip: text`, `git push --force`), because the model answers the words, not the intent. Put boundary cases in `yes:` and `no:`. Leave arithmetic to code, as a fact.
4. **Gate with `when`,** using axes (`visual: ">=0.6"`) or facts (`"evidence.edited": true`), instead of folding those conditions into the question.
5. **Refusals need extra care.** `deny` and `block` take `min: 0.85` or higher, and an `unless` that asks whether the user asked for exactly this. A wrong refusal costs more than a missed note. When the harm isn't concrete, use `context`.
6. **Write the body for a capable colleague.** Name the failure in a sentence or two, then write `Instead:` and the concrete alternative. Give the reason, because agents rightly distrust unexplained instructions injected mid-session. Keep it under 900 characters.
7. **Cite the source:** the user's own words, the date, the session or incident. An entry without evidence is an opinion.

A design telltale, in the shape every shipped `slop/` entry uses:

```markdown
---
event: tool
tools: [Write, Edit, MultiEdit, apply_patch, Bash]
ask: Does `input` write user-interface code that <the pattern, as code spells it>?
yes: <what counts>
no: <look-alikes that must pass>. The pattern is only named in prose, comments, documentation, a lint rule, a test, or a list of things to avoid; the command only reads or searches files; or the file is not part of a user interface.
unless: Does `request` explicitly ask for <the pattern>?
min: 0.85
action: deny
title: <a few words>
source: <where it came from>
---
<Why it reads as generated, in one or two sentences.>

Instead: <the concrete alternative.>
```

A `slop/` entry also teaches the design review: its title and first body line join the list of telltales the reviewer flags.

**The design law** is a different tool. It is a free-form Markdown file of the user's rules, as long as they like. When it exists, agents are told to read it before visual work, and the end-of-turn reviewer judges against it. It advises and never refuses. For the few rules worth refusing at the edit, also write a `slop/` entry.

## 3. Prove it

The change is live on the next hook call. Nothing needs reinstalling.

1. Run `jevis lint`. It must print no `BROKEN` line, and its `replaced` and `off` lines must match what you intended. A broken replacement leaves the shipped entry in force.
2. Dry-run at least one case that should fire and two look-alikes that should not:

   ```sh
   node bin/jevis.mjs ask "make me a landing page for my bakery"
   node bin/jevis.mjs ask --event tool --tool Bash --request "tidy the repo" "git clean -fdx"
   node bin/jevis.mjs ask --event tool --tool Write --request "build our pricing page" "Write app/pricing.tsx
   <the lines the edit adds>"
   node bin/jevis.mjs ask --event stop --request "fix the signup bug" \
     --evidence '{"edited":true,"files_changed":["src/signup.ts"],"files_changed_count":1,"ui_files_changed":[],"actions_after_last_edit":[],"recent_actions":[],"commands_run":0,"used_subagents":false}' \
     "Fixed and tested."
   ```

   For an entry with a `family:`, add a model from that family, such as `--model gpt-6-sol` or `--model claude-opus-5-5`. Without `--model`, entries of both families are asked, as they are for Gemini, Grok, and other models. The output shows each firing entry's probability and the closest ones that did not fire. The hit should clear `min` with room to spare, and each look-alike should sit well below it, ideally under 0.5. When a case lands near the line, rewrite `ask`, `yes`, and `no` rather than moving `min`.
3. Replay real history when the user has it: `jevis replay <session file or id>` on a session where the failure happened and on one where it didn't.
4. For code changes, add a test beside the existing ones and run `npm test`. Document any new fact or axis in `WIKI.md`.
5. For a contribution to the shipped `slop/` area, add a telltale case and its look-alikes to `eval/slop-cases.mjs`, then run `node eval/slop.mjs`. Every case must stay right.

`jevis ask` calls the configured decision model, so it needs a TypeSafe key or a running self-hosted server. If it reports an error, say the change is untested rather than implying it works. For a new `deny` or `block`, suggest the user run Jevis in shadow mode (`JEVIS_MODE=shadow`) for a few days and read `jevis stats`.

## 4. Report back

Tell the user:
- which files you added or changed, with full paths;
- the dry-run probability for each case, hits and look-alikes;
- what you couldn't test.

Remind them that every entry adds one question to each event of its kind. The questions run in parallel, so the delay stays flat while the token cost grows.
