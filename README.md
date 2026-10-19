# Jevis

Every good role-playing game teaches you how to play it while you play: a tip when you reach a new area, a hint when you're stuck. Jevis does that for coding agents. It's a set of hooks that gives each agent the right short tip at the moment it matters, tuned to that model's known habits.

Tips are short Markdown files you can read, edit, or switch off. Code picks them, so they need no API key and cost only the lines they add to the agent's context. Jevis works with Claude Code and Codex out of the box, and with Gemini CLI, Antigravity, and Muse Code [by hand](docs/harnesses.md).

> **Jevis is not a gate.** It never refuses a tool call or an edit, never manages permissions, and never filters anything. It sends an agent back in only two cases: a final message claiming checks pass when the last run failed, and the optional design review.

<img src="docs/media/before-after.jpg" width="560" alt="The same pottery-studio prompt given to Codex (GPT-6 Sol) twice. Bare, it made a plain two-column page with a grey 'Studio photo to add' placeholder. With Jevis, it made a full-bleed photo of hands throwing a pot with the headline 'Clock off. Clay on.'">

*The same prompt to Codex, bare and with Jevis v1 ([evidence](docs/evidence.md)). There's also a [73-second explainer video](docs/media/jevis-explainer.mp4).*

## What it does

| Moment | Hook | What the agent gets |
|---|---|---|
| A session starts, resumes, or is compacted | `SessionStart` | The session guide: read for intent, handle ambiguity, check how the project already works, finish the outcome rather than the words. Concrete judgment examples. Design guidance, including the generated-looking defaults that model's family reaches for. |
| You send a message | `UserPromptSubmit` | A short reminder of the session guide and a line on interface copy. GPT models also get a line on reading words literally. Short, vague feedback ("not good", "try again") gets a tip on working out what missed, and a second one gets a stronger tip. |
| The agent is about to run a command or edit | `PreToolUse` | A tip when it fits the moment ([all tips](docs/tips.md)). The call itself is never changed. |
| A tool finishes | `PostToolUse` | Nothing visible. Jevis records exit codes and changed files for the other hooks. |
| The agent is about to end its turn | `Stop` | Sent back if its final message says checks pass when the last check after an edit failed. With the design review on, visual work is rendered and reviewed first. |

## Install

You need Node 22 or newer.

```sh
git clone https://github.com/GLDRoger/jevis.git ~/code/jevis
cd ~/code/jevis && npm install
node bin/install.mjs --dry-run   # show what changes in ~/.claude/settings.json and ~/.codex/hooks.json
node bin/install.mjs             # install for both; old configs are backed up in ~/.jevis/backups/
node bin/jevis.mjs doctor        # check the setup
```

Hooks take effect in new sessions; Codex asks you to approve them once. Useful flags: `--harness codex` (one harness), `--shadow` (log only, change nothing), `--critic off` (no design review), `--uninstall`. Jevis fails open: if anything breaks, the agent carries on as if it weren't there.

The optional design review renders visual work and has a second model critique it. It needs a working decision model (a key, for the hosted ones), Chrome, and the `claude` or `codex` CLI; without them it's skipped. See [Configuration](docs/configuration.md).

## Make it yours

Your changes live in `~/.jevis/`, so `git pull` never touches them, and they take effect on the next hook call.

- **Change a tip:** copy it from `nudges/` to `~/.jevis/nudges/` with the same name, and edit the copy.
- **Turn a tip off:** put `off: true` in that copy's frontmatter. `JEVIS_NUDGES=off` turns all tips off.
- **Add a tip:** a new file in `~/.jevis/nudges/` with one of the [`hook:` values](docs/tips.md).
- **Add a design rulebook:** write your design rules as Markdown in `~/.jevis/design-law.md`. The design review judges against it.
- **Add a check:** a lesson in `~/.jevis/wiki/`. Lessons are yes/no questions a decision model answers about a command, an edit, or a final message, and they add a tip when the answer is yes. They need a decision-model key. [WIKI.md](WIKI.md) is the guide.
- **Share lessons with a repository:** put them in its `.jevis/wiki/`. They load only inside that repository, and only after you run `node bin/jevis.mjs trust <repo>`. Trust is pinned to the files' contents, so any change needs trusting again.

Or have your agent do it. [`skills/jevis/SKILL.md`](skills/jevis/SKILL.md) teaches any coding agent how to change Jevis and prove the change works:

```text
Read ~/code/jevis/skills/jevis/SKILL.md, then add a tip that tells the agent to run the linter before committing.
```

## Docs

- [Tips](docs/tips.md): every tip, when it shows, and worker sessions.
- [Configuration](docs/configuration.md): the design review, the decision model, every setting, and the commands that show what Jevis is doing.
- [Other harnesses](docs/harnesses.md): Gemini CLI, Antigravity, Muse Code, the Codex plugin, manual setup, and Windows.
- [Writing lessons](WIKI.md): checks that depend on what a command or edit contains.
- [Evidence and model choice](docs/evidence.md): what the v1 evaluation measured, and which coding models to use.

## Privacy

Tips send nothing anywhere. The decision model (only for the design review and your own lessons) receives the user's message, the command or edit, the final message, and file names, as written; the reviewer CLI receives screenshots. Everything else stays in `~/.jevis`, readable only by you.

## Contributing and license

[CONTRIBUTING.md](CONTRIBUTING.md) covers setup and what a change needs to be merged. MIT, see [LICENSE](LICENSE).
