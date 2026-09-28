# Writing wiki entries

The wiki is what Jevis knows: one Markdown file per lesson, under `wiki/<area>/<name>.md`. The path, without `wiki/` and `.md`, is the entry's id (`design/open-landing-default`).

## Your own entries

Jevis loads two wikis: the shipped `wiki/` in this repo, then yours in `~/.jevis/wiki/` (under `JEVIS_HOME` if you set it). Put your entries in yours, so pulling a new version of Jevis never touches them.
- A new id adds a lesson.
- The same id as a shipped entry replaces it. Copy the shipped file across and edit the copy.
- A file with only `off: true` in its frontmatter turns the shipped entry with that id off:

  ```markdown
  ---
  off: true
  ---
  ```

`node bin/jevis.mjs lint` lists what yours replaced and turned off. A broken replacement leaves the shipped entry in force until lint passes. `JEVIS_WIKI` (colon-separated folders, later ones winning) replaces both defaults.

On every hook event, Jevis sends Jev the event's state plus the `ask` (and `unless`) question of every entry for that event, all in one call. Questions in a call are answered in parallel, so the wiki can grow into the hundreds without slowing a hook. An entry fires when three things hold:
- its `ask` answer clears `min`;
- its `unless` answer stays under `unless_max`;
- its `when` conditions hold.

What it does next depends on its `action`.

## Format

```markdown
---
event: prompt
ask: Does `request` ask for a new website, landing page, or app screen and leave most of its look (layout, palette, type) to the agent?
yes: A new page or screen, with the look left open
no: The look is specified, the project's existing design applies, or nothing visual is being made
min: 0.75
when: { wants_change: ">=0.6", correction: "<0.5" }
family: gpt
action: context
title: The default AI landing page
source: an earlier hook system's default-look gate, 40+ blocked Sol builds, Aug-Sep 2026
---
Sol's first draft of an open page is one layout: centered hero, gradient blob, three feature cards, logo strip, pricing table, in Inter on near-white.

Instead: pick one concept from the product's own world and let it decide the layout, type, and palette before writing markup.
```

| Field | Required | Meaning |
|---|---|---|
| `event` | yes | `prompt` (the user sent a message), `tool` (the agent is about to run a tool), or `stop` (the agent is about to end its turn) |
| `ask` | yes | One literal yes/no question about the state. Name the state fields it reads in backticks. |
| `yes`, `no` | no | What a yes and a no mean. Put the boundary cases here. |
| `min` | no | The probability the `ask` answer must reach. Default 0.75. Use 0.85 or more for `deny` and `block`. |
| `unless` | no | A second yes/no question that stands the entry down, usually "did the user ask for exactly this?". Jev answers each literal question better than a compound one: a deny asked as "is this destructive, when the user did not ask for it?" scored 0.86 on a case it should catch; split into `ask` and `unless`, the same case scored 0.97 and 0.28. |
| `unless_max` | no | The `unless` answer at or above which the entry stands down. Default 0.5. |
| `when` | no | Conditions that must also hold: axes (see below) with `">=x"` or `"<x"`, and facts with a literal value (`{ "evidence.checks_after_last_edit": false }`). |
| `tools` | tool only | Tool names the entry applies to: `Bash`, `apply_patch` (Codex), `Edit`, `Write`, `MultiEdit`, `mcp__*`. Glob `*` allowed. |
| `family` | no | `claude` or `gpt`, for a lesson that fixes one family's habit. A model from any other family (Gemini, Grok, an open model), or an unknown one, gets both families' lessons. Leave it out for a lesson every model needs. |
| `optional` | no | `true` keeps the entry off until `JEVIS_ENABLE` names its id, its area, or `all`. For rules the harness already covers. |
| `action` | yes | `context` adds the body to what the agent reads (prompt and tool); `deny` refuses the tool call with the body as the reason (tool); `block` sends the agent back to work with the body as the reason (stop). |
| `title` | yes | A few words naming the lesson. |
| `source` | yes | Where the lesson came from: session ids, dates, counts, a file. An entry without evidence is an opinion. |

## The state Jev reads

**prompt**
- `request`: the user's message, with secrets masked.
- `previous_request`: the user's message before it, if any.
- `attachments`: attached file names.
- `workspace`: `git` (a repository or not), `files` (up to 40 top-level names), `empty`.
- `agent`: `harness` (Codex or Claude Code), `model`, `origin` (`person`, or `agent` when another agent started this session).

**tool**
- `request`: the user's current message.
- `tool`: the tool name.
- `input`: the command (up to 4,000 characters), or for an edit, the file path and only the lines it adds: the removed and unchanged lines of an `apply_patch` are left out, so a check judges what the edit introduces. Secrets are masked before Jev sees any of it (`src/redact.mjs`).
- `marks`: exact facts about `input` that code checks, because Jev blurs or cannot see them: `marks.em_dash` (it contains U+2014, not an en dash) and `marks.ran_before` (this session already ran this exact command).
- `workspace`: as above.

**stop**
- `request`: the user's current message.
- `final_message`: what the agent is about to end its turn with.
- `evidence`, facts computed from the session log (subagents included) since the turn began:
  - `edited` (boolean), `files_changed` (up to 20), `files_changed_count`, `ui_files_changed` (markup and style files, tests excluded);
  - `actions_after_last_edit`: commands with exit codes (`exit 0: pnpm test`), tool calls with their title or code (`tool node_repl.js Check the form: await tab.goto(…)`), image views, and subagent runs;
  - `recent_actions`: the turn's last 12 actions, edits included;
  - `commands_run`, `used_subagents`;
  - `files_written_by_commands`: files under the project modified during the turn that no edit tool recorded (a heredoc, a script, a JavaScript exec). They are also counted in `files_changed` and `ui_files_changed`, and they set `edited`.

  Whether an action was a test, a build, or a browser check is Jev's call: ask it about `evidence.actions_after_last_edit`.

## Axes

Axes are the shared profile, the spider chart, that Jev scores on every event of a kind. Entries use them in `when` to share a gate instead of repeating it. `src/axes.mjs` defines them.

**prompt**
- `wants_change`: the user wants something made or changed, not an answer.
- `open_ended`: most decisions about the result are left to the agent.
- `visual`: the result is something people look at.
- `code`: software changes.
- `new_build`: something new from scratch.
- `risky`: production, data, money, credentials, or hard to undo.
- `correction`: the user is correcting the agent's earlier work.
- `delegation`: the user wants other agents used.
- `current_facts`: the answer depends on facts that may have changed recently.
- `writing`: prose is the product.

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

`wiki/slop/` holds `deny` entries on edits (`Write`, `Edit`, `MultiEdit`, `apply_patch`, and `Bash` heredocs) for the telltales of generated design: gradient text, purple gradients, emoji and Unicode glyphs as icons, frosted glass, glow blobs, feature-card rows, announcement pills, marquees, rotating text stamps, invented social proof, hype copy, the italic accent word, numbered mono labels, hover lift on every card, unasked template sections, colored left-edge bars, decorative SVG, and section-scrolling sidebars.

Each one follows the same shape:
- `ask` names the pattern as code would write it (`background-clip: text`, `border-l-4`, `<textPath>`), because Jev reads the edit literally.
- `no` lists the look-alikes that must pass (a brand's own gradient, a data chart, an imported icon, a docs page naming the pattern) and ends with the shared clause for prose, comments, searches, and non-interface files.
- `unless` asks whether the user asked for exactly this.
- The body says why it reads as generated, then `Instead:` with the concrete alternative.

The critic reads every slop entry's title and first line as its list of telltales, so a new entry also teaches the design review. Test changes with `node eval/slop.mjs`: every case must stay right, the look-alikes included.

## Writing a good entry

- **One failure per entry.** Two failures are two entries, because they fire under different conditions.
- **Make the `ask` literal.** Jev answers the words you wrote, not the ones you meant. If you would explain what you meant, that explanation belongs in `yes` and `no`. Keep counting and arithmetic out of the question: that belongs in code, as a fact.
- **Body.** One or two sentences naming the default failure, then what to do instead. Write it as guidance to a capable colleague, in two to six lines. Point to a skill path when the fix needs a procedure.
- **Deny and block.** Use them only when the harm is concrete and the question is precise. A wrong block costs more than a missed note: an earlier hook system once held a session for hours over one.
- **The user's words win.** A body never overrides what the user asked for. Every `deny` and `block` entry needs an `unless` that asks whether the user asked for exactly this. Write it literally, with its boundary cases: "run the QA pass" first read as asking to see a window (0.77) until the question said that testing and checking do not count (0.07).
- **Give the reason.** Agents rightly distrust unexplained instructions injected mid-session. In a live test, both Claude Sonnet and GPT-6 Sol flagged a bare "end your reply with this word" as possible injection. A body that names the failure and the user's interest reads as what it is: advice from this user's history.
- **Test before you ship it.** Run `jevis ask` for single cases, and `jevis replay <session>` against real sessions where the failure happened and where it did not.
