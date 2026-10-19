# Writing wiki entries

The wiki is what Jevis knows: one Markdown file per lesson, under `wiki/<area>/<name>.md`. The path, without `wiki/` and `.md`, is the entry's id (`slop/gradient-text`).

V2 ships 31 tool lessons and one code-decided Stop lesson. Prompt hooks do bookkeeping only: prompt entries are not evaluated or injected. Stop accepts only entries with a `decide` code rule, plus an optional independent design review; `verification/claim-contradicted` is the only shipped Stop entry. Model-judged Stop blocks are retired. The 61 retired v1 lessons in `archive/wiki-v1/` and the five retired guards in `archive/wiki-v2-guards/` are outside the wiki roots and are not loaded. Standing advice belongs in the user's AGENTS.md/CLAUDE.md.

## Your own entries

Jevis loads the shipped `wiki/` in this repo, then yours in `~/.jevis/wiki/` (under `JEVIS_HOME` if you set it), then, inside a repository that has one and once you trust it, the repository's `.jevis/wiki/`. Put your entries in yours, so pulling a new version of Jevis never touches them.
- A new id adds a lesson.
- The same id as a shipped entry replaces it. Copy the shipped file across and edit the copy.
- A file with only `off: true` in its frontmatter turns the shipped entry with that id off:

  ```markdown
  ---
  off: true
  ---
  ```

`node bin/jevis.mjs lint` lists what yours replaced and turned off. A broken replacement leaves the shipped entry in force until lint passes. `JEVIS_WIKI` (colon-separated folders, later ones winning) replaces all the defaults.

A repository's `.jevis/wiki/` works the same way, for everyone who works in it, with one difference. It loads only after `jevis trust <repo>`, and only as its files were when trusted: any change needs trusting again. Trusted lessons can replace or turn off any earlier entry. Run `lint` from inside the repository to check its lessons, trusted or not.

On tool events, Jevis sends the decision model (Jev or GPT-6 Luna, whichever `JEVIS_DECIDER` selects) unresolved `ask` questions and any needed axes. Prompt hooks never call it. Stop requests review axes only when an enabled critic has rounds left and edits exist; only `decide` entries can otherwise participate. Model-decided entries ask `unless` in a second call only after clearing `min` and `when`; code-decided positive matches include `unless` in the first call. Both phases share one deadline. A failed second call stands down only entries awaiting exceptions. An entry can opt into a code rule with `decide` (below). Questions within each call are answered in parallel. An entry fires when three things hold:
- its `ask` answer clears `min`;
- its `unless` answer stays under `unless_max`;
- its `when` conditions hold.

Facts in `when` are known before the decision model is asked, so an entry whose facts already fail is left out of the call. When that leaves a tool call with no entry at all, there is no call.

What it does next depends on its `action`.

With `decide`, exact matches need no model answer to `ask`, and exact non-matches need neither question. Positive matches still ask the model the separate `unless`, when present: permission and supplied copy need judgment. A missing or failed exception answer never refuses a call. When all tool entries and their gates are settled by code, no decision-model call is made. The event log records `code` (exact lesson decisions) and `jevQuestions`; code scores are not model probabilities or training labels. Keep `ask`, `yes`/`no`, and `unless` as the fallback contract; custom lessons opt in explicitly.

## Format

```markdown
---
event: tool
tools: [Write, Edit, MultiEdit, apply_patch]
ask: Does `input` add gradient-filled interface text?
yes: A heading, word, or number uses a gradient clipped to text
no: Solid text, non-text gradients, or examples in developer documentation
min: 0.85
decide: gradient_text
unless: Does `request` explicitly ask for gradient-filled text?
action: deny
title: Gradient-filled text
source: recurring generated-design pattern in the maintainer's sessions
---
Gradient-filled text is a stock generated-design tell. Use a solid text color instead.
```

| Field | Required | Meaning |
|---|---|---|
| `event` | yes | `tool` (before a tool), or `stop` (before ending, requires `decide`). `prompt` is still parseable for historical/offline records, but ignored by hooks |
| `ask` | yes | One literal yes/no question about the state. Name the state fields it reads in backticks. |
| `yes`, `no` | no | What a yes and a no mean. Put the boundary cases here. |
| `min` | no | The probability the `ask` answer must reach. Default 0.75. Use 0.85 or more for `deny` and `block`. |
| `decide` | no | A named predicate in `src/rules.mjs`: `em_dash_copy`, `gradient_text`, `emoji_icons`, or `claim_contradicted`. Code answers the `ask` with 0 or 1 when exact; ambiguous input falls back to the decision model. A rule error stands the lesson down. |
| `unless` | no | A second yes/no question that stands the entry down, usually "did the user ask for exactly this?". Both decision models answer a literal question better than a compound one: a deny asked as "is this destructive, when the user did not ask for it?" scored 0.86 on a case it should catch; split into `ask` and `unless`, the same case scored 0.97 and 0.28. |
| `unless_max` | no | The `unless` answer at or above which the entry stands down. Default 0.5. |
| `when` | no | Conditions that must also hold: axes (see below) with `">=x"` or `"<x"`, and facts with a literal value (`{ evidence.edited: true }`, `{ marks.plain_read: false }`). |
| `tools` | tool only | Tool names the entry applies to: `Bash`, `apply_patch` (Codex), `Edit`, `Write`, `MultiEdit`, `mcp__*`. Glob `*` allowed. |
| `family` | no | `claude` or `gpt`, for a lesson that fixes one family's habit. A model from any other family (Gemini, Grok, an open model), or an unknown one, gets both families' lessons. Leave it out for a lesson every model needs. |
| `action` | yes | `context` adds the body to what the agent reads (tool only in v2); `deny` refuses the tool call with the body as the reason (tool); `block` sends the agent back to work with the body as the reason (stop). |
| `title` | yes | A few words naming the lesson. |
| `source` | yes | Where the lesson came from: session ids, dates, counts, a file. An entry without evidence is an opinion. |

## The state the decision model reads

**prompt**
No state is sent to the decision model. The hook stores the masked request, previous and earlier requests, model, turn and turn start locally for downstream hooks. It may return the once-per-session outage warning, never lesson notes.

**tool**
- `request`: the user's current message.
- `earlier_requests`: up to 8 of the session's messages before it, oldest first, each cut to 400 characters. For permission given earlier, such as "commit whenever it makes sense".
- `tool`: the tool name.
- `input`: the command (up to 4,000 characters), or for an edit, the file path and only the lines it adds: the removed and unchanged lines of an `apply_patch` are left out, so a check judges what the edit introduces. Secrets are masked before Jev sees any of it (`src/redact.mjs`).
- `marks`: exact facts about `input` that code checks, because a decision model blurs or cannot see them:
  - `marks.em_dash`: it contains U+2014, not an en dash; unknown (`null`) when a clipped input could hide one;
  - `marks.ran_before`: this session already ran this exact command;
  - Bash effects: `marks.git_write`, `marks.writes_file`, `marks.runs_tests`, `marks.opens_app`. They are `true` for explicit operations, `false` only for proven irrelevance, and `null` (unknown) for scripts, expansions, parse failures, or clipped inputs. `when: { marks.writes_file: true }` requires a proven write: false and unknown both remove the lesson. The other Bash effects and `marks.em_dash` keep their gates open on null. On other tools, writes are true for edit/patch tools and the remaining effects are unknown. `marks.uses_credentials` is false only for plain reads or a small set of local utilities that cannot consume or set credentials; other cases remain unknown.
  - `marks.plain_read`: a shell command that provably only reads, such as `ls`, `rg -n x src | head`, `sed -n 1,80p f`, `git log`, or `gh pr view`. Jevis's own read-only commands (`jevis ask`, `lint`, `stats`, `replay` without `--record`, `doctor`, `cost`) count too: the sample they judge is test data. It is false for any redirect into a file, substitution, variable expansion, heredoc, unknown program, or anything that names a credential (`src/shell.mjs`), and for every tool but `Bash`.

  An entry about what a command writes, runs, opens, deletes, or which credential it touches adds `when: { marks.plain_read: false }`. A plain read then asks it nothing, and when every entry is gated that way, the call is skipped. Leave the gate off only for a lesson about reads themselves, such as rereading a file. `jevis lint` notes each Bash entry without it.
- `workspace`: `git` (whether this is a repository), `files` (up to 40 top-level names), and `empty`.

**stop**
- `request`: the user's current message.
- `final_message`: what the agent is about to end its turn with.
- `evidence`, facts computed from the session log (subagents included) since the turn began:
  - `edited` (boolean), `files_changed` (up to 20), `files_changed_count`, `ui_files_changed` (markup and style files, tests excluded);
  - `actions_after_last_edit`: commands with exit codes (`exit 0: pnpm test`), tool calls with their title or code (`tool node_repl.js Check the form: await tab.goto(…)`), image views, and subagent runs;
  - `recent_actions`: the turn's last 12 actions, edits included;
  - `checks_after_last_edit`: explicit test/build/check commands after the last edit, with `success` (true/false/null) and `exit_code` when available. PostToolUse completions supplement transcript results and replace matching bare attempts. Unknown or still-running results never count as passing; failed edits do not count as changed files. Muse's fallback without results remains an attempt, not success.
  - `commands_run`, `used_subagents`;
  - `files_written_by_commands`: files under the project modified during the turn that no edit tool recorded (a heredoc, a script, a JavaScript exec). They are also counted in `files_changed` and `ui_files_changed`, and they set `edited`.

  These facts support code checks and the optional review, not model-judged Stop lessons.

## Axes

Axes are shared model judgments defined in `src/axes.mjs`. Tool checks request them when needed. Stop requests its axes only for a possible design/film review; with the critic off and no applicable code entries it asks nothing.

**prompt (historical/offline only)**
The engine still supports prompt axes for old records and offline evaluations, but v2 hooks do not score them, including the `correction` axis used by historical mining.

**tool**
- `destructive`: could delete or overwrite what cannot easily be recovered.
- `outward`: sends or publishes something off this machine.

**stop**
- `work_requested`: the request asked for work, not only an answer or a discussion.
- `claims_done`: the final message says the work is complete.
- `claims_verified`: it says something was tested or checked.
- `visual`: the requested work is something people look at.
- `film`: the request is a film or animated piece meant to be watched as it plays.

`visual` and `film` also decide whether the design or film review runs after the stop entries pass (see the README).

## The slop area

`wiki/slop/` holds `deny` entries on edits (`Write`, `Edit`, `MultiEdit`, `apply_patch`, and `NotebookEdit` where listed; never `Bash`) for the telltales of generated design: gradient text, purple gradients, emoji and Unicode glyphs as icons, frosted glass, glow blobs, feature-card rows, announcement pills, marquees, rotating text stamps, invented social proof, hype copy, numbered mono labels, hover lift on every card, unasked template sections, colored left-edge bars, decorative SVG, and section-scrolling sidebars.

Each one follows the same shape:
- `ask` names the pattern as code would write it (`background-clip: text`, `border-l-4`, `<textPath>`), because the decision model reads the edit literally.
- `no` lists the look-alikes that must pass (a brand's own gradient, a data chart, an imported icon, a docs page naming the pattern) and ends with the shared clause for prose, comments, searches, and non-interface files.
- `unless` asks whether the user asked for exactly this.
- The body says why it reads as generated, then `Instead:` with the concrete alternative.

The critic reads every slop entry's title and first line as its list of telltales, so a new entry also teaches the design review. Test changes with `node eval/slop.mjs`: every case must stay right, the look-alikes included.

## Writing a good entry

- **One failure per entry.** Two failures are two entries, because they fire under different conditions.
- **Make the `ask` literal.** The decision model answers the words you wrote, not the ones you meant. If you would explain what you meant, that explanation belongs in `yes` and `no`. Keep counting and arithmetic out of the question: that belongs in code, as a fact.
- **Body.** One or two sentences naming the default failure, then what to do instead. Write it as guidance to a capable colleague, in two to six lines. Point to a skill path when the fix needs a procedure.
- **Deny and block.** Use them only when the harm is concrete and the question is precise. A wrong block costs more than a missed note: an earlier hook system once held a session for hours over one.
- **The user's words win.** A body never overrides what the user asked for. Every permission-sensitive `deny` or `block` entry needs an `unless` that asks whether the user asked for exactly this. Write it literally, with its boundary cases: "run the QA pass" first read as asking to see a window (0.77) until the question said that testing and checking do not count (0.07).
- **Give the reason.** Agents rightly distrust unexplained instructions injected mid-session. In a live test, both Claude Sonnet and GPT-6 Sol flagged a bare "end your reply with this word" as possible injection. A body that names the failure and the user's interest reads as what it is: advice from this user's history.
- **Test before you ship it.** Run `jevis ask` for single cases, and `jevis replay <session>` against real sessions where the failure happened and where it did not.
- **Test on both deciders.** `min` and `unless_max` were tuned on Jev's probabilities, and GPT-6 Luna's sit differently: it answers `unless` ("did the user ask for exactly this?") higher. Run your cases with `JEVIS_DECIDER=luna` as well as the default, and set thresholds that hold on the decider you use. `jevis stats --near` reads only the active decider's records.
