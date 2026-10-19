---
name: jevis
description: Change what Jevis does for your coding agents. Add, edit, or turn off a tip, a lesson, the Stop check, or the design rules the reviewer uses, and prove the change works. Use when the user wants Jevis to say, notice, or check something new, or to stop doing something.
---

# Changing Jevis

Jevis is a set of agent hooks that give coding agents short tips at the right moment. Most of what it says is a **tip**: a Markdown file whose frontmatter says when it shows and for which model family. Tips are chosen by code and cost no model call. When whether something applies depends on the content of a command, an edit, or a final message, it needs a **lesson** instead: a yes/no question a decision model answers.

Prefer a tip. Reach for a lesson only when a fixed moment can't express the change, and for code only when neither can.

Paths below are relative to the Jevis repo, two folders above this file. `jevis` means `node bin/jevis.mjs`, run from the repo. If this skill came from an installed plugin, that location is the plugin cache: treat its files as read-only, put the user's changes in `~/.jevis/`, and make contributions in their source checkout.

## 1. Pin down the change

Restate the wish as one sentence: "When <moment>, Jevis should tell the agent <what>." For a vague wish ("stop Codex making cheap-looking buttons"), name the concrete pattern and one example that must not trigger it. Check with the user only if the boundary is genuinely unclear.

Then find the row:

| The user wants Jevis to… | Change | Where |
|---|---|---|
| say something at session start, on every message, on vague feedback, or at another fixed moment | a tip with that `hook:` | `~/.jevis/nudges/<name>.md` |
| reword a shipped tip | a copy with the same file name | `~/.jevis/nudges/<same name>.md` |
| stop a shipped tip | that copy with `off: true` in its frontmatter | `~/.jevis/nudges/<same name>.md` |
| tell the agent something only when a command or edit matches a pattern | a `tool` lesson, `action: context` | `~/.jevis/wiki/<area>/<name>.md` |
| retune, replace, or turn off a shipped lesson | a file with the same id | `~/.jevis/wiki/<same id>.md` |
| give everyone in one repository a lesson | a lesson in the repository; the user runs `jevis trust <repo>` | `<repo>/.jevis/wiki/<area>/<name>.md` |
| have the design reviewer judge by the user's own rules | the design law | `~/.jevis/design-law.md` |
| change the reviewer, act only in some folders, go quiet, switch decision model | configuration | `~/.jevis/config.json` (README, Configuration) |
| show a tip at a moment no `hook:` covers | code: a new hook value | `src/nudges.mjs` (`HOOKS`) and the call site in `src/hooks.mjs` |
| judge a fact the state doesn't carry, such as a count | code: a new fact | `src/context.mjs` or `src/hooks.mjs`, then WIKI.md |
| change how pages or films are reviewed | code | `src/review.mjs` (`criticPrompt`, `REVIEW_ROUNDS`) |

Tip hooks: `session` (start, resume, and after compaction), `prompt` (every message), `feedback` and `feedback-repeat` (short vague feedback, first and later), `worker` (every message in a session another agent started), `search` (first `grep`/`find`, again after compaction), `repeat-failure` (a command about to rerun after its last two runs failed), `repeat-check` (a check about to rerun with no edit since; shell-written changes aren't tracked), `port-in-use` (the next tool call after a port clash), `ui-edit` (first interface edit of a turn). `family:` is `claude`, `gpt`, or `other`; leave it out for every model.

Edit the repo's `nudges/` or `wiki/` only when the change is meant for every Jevis user, as a contribution.

A repository's `.jevis/wiki/` loads only after the user trusts it, because trusting lets the repository's text into every session there. Write the lesson, lint it from inside the repository, and ask the user to run `trust` once they've read it.

**When the user asks what Jevis should change based on their history,** or whether it's worth its cost, follow `skills/jevis-improve/SKILL.md` instead. A habit that repeats across sessions often belongs in the user's AGENTS.md or CLAUDE.md, which costs nothing at runtime.

## 2. Write it

**A tip.** Read the shipped tips in `nudges/` first, and replace one by name rather than adding a second that says the same thing.

- Write for a capable colleague: name what goes wrong, why, and what to do instead, in a few lines. Agents rightly distrust unexplained instructions injected mid-session.
- A tip may restate one of the user's instruction-file rules in fewer words. It never contradicts them.
- Keep it short. Tips on `prompt` are paid on every message; the body is cut at 1,500 characters.

```markdown
---
hook: prompt
family: gpt
---
<What to do, and why, in one to three sentences.>
```

**A lesson.** Read WIKI.md in full first. It defines every field, what each event can read, and the axes. Then:

1. **Check what exists** in `wiki/` and `~/.jevis/wiki/`. Replace a nearby lesson by id instead of adding one that fires alongside it.
2. **Ask one literal question** that names the state field in backticks and spells the pattern the way code would (`git push --force`, `background-clip: text`). Put boundary cases in `yes:` and `no:`. Leave arithmetic to code.
3. **Gate with `when`** rather than folding conditions into the question. A Bash lesson about what a command writes, runs, or opens takes `when: { marks.plain_read: false }`.
4. **Add `unless`** when the user may have asked for exactly this ("Does `request` ask for it?").
5. **Use `action: context`.** Lessons only add tips. Jevis never refuses calls, manages permissions, or filters data; the code-decided pass-claim check is the only shipped send-back.
6. **Cite the source:** the user's words, the date, the session. A lesson without evidence is an opinion.

**The design law** is a free-form Markdown file of the user's design rules, as long as they like. The end-of-turn reviewer judges against it. Add a line to the user's AGENTS.md or CLAUDE.md if agents should also read it before visual work.

## 3. Prove it

Changes are live on the next hook call. Nothing needs reinstalling.

1. Run `jevis lint`. It must print no `BROKEN` line, and its tip counts and `replaced`/`off` lines must match what you intended.
2. **For a tip,** run the hook by hand and check the text appears, with a model from the right family:

   ```sh
   echo '{"session_id":"check-tip","model":"gpt-6-sol"}' | node bin/jevis.mjs hook session
   echo '{"session_id":"check-tip","model":"gpt-6-sol","prompt":"add a settings page"}' | node bin/jevis.mjs hook prompt
   ```

3. **For a lesson,** dry-run one case that should fire and two look-alikes that shouldn't:

   ```sh
   node bin/jevis.mjs ask --event tool --tool Bash --request "tidy the repo" "git clean -fdx"
   node bin/jevis.mjs ask --event tool --tool Write --request "build our pricing page" "Write app/pricing.tsx
   <the lines the edit adds>"
   ```

   Add `--model gpt-6-sol` or `--model claude-opus-5-5` for a family lesson. The hit should clear `min` comfortably and the look-alikes should sit under 0.5. If a case lands near the line, reword `ask`, `yes`, and `no` rather than moving `min`. `jevis ask` calls the configured decision model; if it errors, say the lesson is untested. Test on the decider the user runs (`JEVIS_DECIDER=luna` for Luna).
4. **With history,** `jevis replay <session>` on a session where the failure happened and one where it didn't. For an existing lesson, `jevis stats --near` shows how it fares against every recorded answer.
5. **For code,** add a test beside the existing ones and run `npm test`.

If Jevis seems not to run at all, `jevis doctor` checks the installation end to end.

## 4. Report back

Tell the user which files you added or changed (full paths), what the dry runs showed, and what you couldn't test. For a lesson, say what it costs: each matching event that its `when` facts and code don't settle asks the decision model its question, plus `unless` and any axes it gates on.
