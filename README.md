# Jevis

Every good role-playing game teaches you how to play it while you play: a tip when you reach a new area, a hint when you're stuck, a guide you can open whenever you want. Jevis does that for coding agents. It's a set of hooks that gives each agent the right short tip at the moment it matters, tuned to that model's known habits. Its one goal is better work from the models.

Tips never take the controller away. They add context and the agent carries on.

> **Jevis is not a gate.** It never refuses a tool call or an edit, never manages approvals or permissions, and never masks or filters anything. That is the job of you and your harness. It sends an agent back in only two cases: a final message claiming checks pass when the last run failed, and the optional design review.

Every tip is a short Markdown file you can read, edit, or switch off. Tips are chosen by code, so they cost nothing but the few lines they add to the agent's context. Everything Jevis does is logged as JSON lines on your machine.

It works with **Claude Code** and **Codex** out of the box, and with **Gemini CLI**, **Antigravity CLI**, and **Muse Code** through the same commands.

<img src="docs/media/before-after.jpg" width="560" alt="The same pottery-studio prompt given to Codex (GPT-6 Sol) twice. Bare, it made a plain two-column page with a grey 'Studio photo to add' placeholder. With Jevis, it made a full-bleed photo of hands throwing a pot with the headline 'Clock off. Clay on.'">

*The same prompt to Codex, bare and with Jevis v1 ([evidence](#evidence)). There's also a [73-second explainer video](docs/media/jevis-explainer.mp4).*

- [What it does](#what-it-does)
- [Install](#install)
- [Make it yours](#make-it-yours)
- [The design review](#the-design-review)
- [The decision model](#the-decision-model)
- [Configuration](#configuration)
- [See what it's doing](#see-what-its-doing)
- [Other harnesses](#other-harnesses)
- [Evidence](#evidence)
- [Which coding model to use](#which-coding-model-to-use)
- [Privacy](#privacy)

## What it does

| Moment | Hook | What the agent gets |
|---|---|---|
| A session starts, resumes, or is compacted | `SessionStart` | The session guide: read for intent, handle ambiguity, check how the project already works, finish the outcome rather than the words. Concrete judgment examples. Design guidance, including the generated-looking defaults that model's family reaches for. |
| You send a message | `UserPromptSubmit` | A short reminder of the session guide and a line on interface copy. GPT models also get a line on reading words literally. Short, vague feedback ("not good", "try again") gets a tip on working out what missed, and a second one gets a stronger tip. |
| The agent is about to run a command or edit | `PreToolUse` | A tip when it fits the moment (below). The call itself is never changed. |
| A tool finishes | `PostToolUse` | Nothing visible. Jevis records exit codes and changed files for the other hooks. |
| The agent is about to end its turn | `Stop` | Sent back if its final message says checks pass when the last check after an edit failed. With the design review on, visual work is rendered and reviewed first. |

### Tips

Tips live in [`nudges/`](nudges/), one Markdown file each. The frontmatter says when the tip is shown (`hook:`) and, optionally, which model family sees it (`family: gpt`, `claude`, or `other` for every model outside those two). The body is what the agent reads, cut at 1,500 characters.

| `hook:` | When it shows |
|---|---|
| `session` | Session start, resume, and after compaction |
| `prompt` | Every message |
| `feedback`, `feedback-repeat` | Short, vague feedback; a second one in the same session |
| `worker` | Every message in a session started by another agent, instead of the `prompt` tips |
| `search` | The first `grep` or `find` command, again after compaction |
| `repeat-failure` | A command about to run again after its last two runs failed (once per command) |
| `repeat-check` | A test or build about to rerun with no edit since the last run (edits made by shell commands aren't tracked) |
| `port-in-use` | The next tool call after one fails because a port is taken |
| `ui-edit` | The first interface edit of a turn (none ship; it's there for your own) |

Every model gets the `base-*` tips. The design tips (`design-*`) are given at session start, so they reach the first file the agent writes: `design-base.md` for everyone, plus a list of generated-looking defaults for that model's family, drawn from the maintainer's logs. GPT models get `gpt-prompt.md` on every message.

A tip earns its place only if it changes what the model does at the moment it matters. Over a long session a model drifts from its system prompt, so a short reminder can restate it. A tip never adds a rule your instruction files contradict. Jevis v1 injected 38 prompt-time notes chosen by a model on every message; a month of real use showed they changed nothing, and they were retired.

### Worker sessions

Sessions started by another agent make no decision-model or external calls. Jevis recognises a worker by the phrase "You were called by another agent. Do this task yourself." in the first prompt (case-insensitive; `JEVIS_WORKER_MARKER` changes it), an agent-origin prefix, or environment markers such as `AGENT_CALL_DEPTH`. Workers keep the session tips and get the worker tip on every message (no one can answer questions, so make the call and list assumptions). They get no feedback tips and no design review. Their log rows carry `worker: true`.

### It fails open

With no key, a timeout, a broken settings file, or a moved checkout, the agent carries on as if Jevis weren't there. `jevis doctor` tells that apart from "nothing applied".

## Install

You need Node 22 or newer. That's all the tips need.

```sh
git clone https://github.com/GLDRoger/jevis.git ~/code/jevis
cd ~/code/jevis
npm install
npm test                          # offline

node bin/install.mjs --dry-run    # show what changes in ~/.claude/settings.json and ~/.codex/hooks.json
node bin/install.mjs              # install for both (old configs are backed up in ~/.jevis/backups/)
node bin/jevis.mjs doctor         # check hooks, settings, key, recent activity
```

The installer adds Jevis's hooks next to your existing ones and leaves the rest alone. Running it twice gives the same config. Hooks take effect in new sessions. Codex asks you to approve new hooks once.

The design review also needs a working decision model (a key, for the hosted ones), Google Chrome, and the `claude` or `codex` CLI. Without them, it is skipped and everything else works. See [The design review](#the-design-review).

Installer options:

```sh
node bin/install.mjs --harness codex     # one harness only
node bin/install.mjs --shadow            # log what Jevis would do, change nothing (--live to switch back)
node bin/install.mjs --critic off        # no design review (or --critic codex)
node bin/install.mjs --decider luna      # GPT-6 Luna instead of Jev (--decider jev to go back)
node bin/install.mjs --jev-url URL       # a self-hosted Jev-compatible server (--jev-url typesafe to go back)
node bin/install.mjs --uninstall         # remove Jevis's hooks
```

Options are saved in `~/.jevis/config.json`, so a plain reinstall keeps them.

**Windows.** The installer writes commands that work in Git Bash, Windows PowerShell 5.1, PowerShell 7, and cmd. Install Node in a folder without spaces: otherwise it may fall back to `node` on PATH, and `doctor` warns about that. CI runs every hook through each of these shells, but nobody has run a live Claude Code or Codex session on Windows or Linux yet. On Windows the design review can't discover a running dev server, so it reviews a localhost URL mentioned in the turn, or else the changed HTML files.

## Make it yours

Your changes live in `~/.jevis/`, so `git pull` never touches them, and they take effect on the next hook call.

- **Change a tip:** copy it from `nudges/` to `~/.jevis/nudges/` with the same name, and edit the copy.
- **Turn a tip off:** put `off: true` in that copy's frontmatter. `JEVIS_NUDGES=off` turns all tips off.
- **Add a tip:** a new file in `~/.jevis/nudges/` with one of the `hook:` values above.
- **Add a design rulebook:** write your design rules as Markdown in `~/.jevis/design-law.md`. The design review judges against it.
- **Add a check:** a lesson in `~/.jevis/wiki/`. Lessons are yes/no questions a decision model answers about a command, an edit, or a final message, and they add a tip when the answer is yes. They need a decision-model key. [WIKI.md](WIKI.md) is the guide.
- **Share lessons with a repository:** put them in its `.jevis/wiki/`. They load only inside that repository, and only after you run `node bin/jevis.mjs trust <repo>`. Trust is pinned to the files' contents, so any change needs trusting again.

Or have your agent do it. [`skills/jevis/SKILL.md`](skills/jevis/SKILL.md) teaches any coding agent how to change Jevis and prove the change works:

```text
Read ~/code/jevis/skills/jevis/SKILL.md, then add a tip that tells the agent to run the linter before committing.
```

## The design review

After a turn of visual work (a page, a component, a film), Jevis renders the result in headless Chrome at 1440 and 390 px, plus dark mode if the page has one. For a film, it samples frames (across the whole runtime when the film exposes a render hook, otherwise the first 40 seconds of playback); with a rendered video and `ffmpeg`, it adds a spectrogram and the loudness, and warns when the video is older than its source. A second model reviews the screenshots as a designer who didn't make the work. It answers "ship" or gives up to five "Now: A. Instead: X." fixes, and the agent gets sent back. The first reviewed turn gets two rounds; later turns get one.

| Install with | Who reviews | Needs |
|---|---|---|
| nothing (default) | Claude, through the `claude` CLI | Chrome, `claude` signed in, a decision-model key |
| `--critic codex` | Codex, through the `codex` CLI | Chrome, `codex` signed in, a decision-model key |
| `--critic off` | nobody | nothing |

The reviewer runs on your own plan with that CLI. The decision model only decides whether the turn was visual work that says it's done; progress reports ("the workers are still rendering") aren't reviewed. `JEVIS_CRITIC_MODEL` picks the reviewer's model. The Stop hook's timeout is 420 s because each round takes about 30 to 90 s.

## The decision model

Tips and the Stop check are decided by code and work without one. A decision model is needed only for the design review and for any lessons you add. Jevis asks it yes/no questions and reads back a probability for each.

**TypeSafe Jev** (default, `jev-1.14.0`). Typical answers come back in under half a second. At the time of writing it costs $0.042 per million input tokens, output free. Get a key from the [TypeSafe console](https://console.typesafe.ai) and save it where only you can read it:

```sh
mkdir -p ~/.jevis/secrets && chmod 700 ~/.jevis ~/.jevis/secrets
printf '%s' 'YOUR_KEY' > ~/.jevis/secrets/typesafe_api_key && chmod 600 ~/.jevis/secrets/typesafe_api_key
```

Or set `TYPESAFE_API_KEY` in the agent's environment.

**GPT-6 Luna**, through OpenAI's [Decisions API](https://developers.openai.com/api/docs/guides/decisions) (public beta, $0.10 per million input tokens). Save the key as `~/.jevis/secrets/openai_api_key` the same way, or set `JEVIS_LUNA_KEY` or `OPENAI_API_KEY`, then install with `--decider luna`. Lesson thresholds were tuned on Jev, and Luna spreads its probabilities differently: on the old tool battery it caught 24 of 34 cases to Jev's 30. Start it in shadow mode and check `jevis stats --near`.

**Self-hosted.** Any server that speaks TypeSafe's `POST /v1/systemone` works, such as [Laya](https://github.com/NandhaKishorM/laya): `node bin/install.mjs --jev-url http://127.0.0.1:8000/v1/systemone`. Laya's current checkpoints didn't separate Jevis's questions in our tests (0 of 35 catches, 4.2 s per call on a laptop), so fine-tune it first. `node bin/jevis.mjs export` turns your recorded Jev calls into a training set for Laya's [fine-tuning notebook](https://github.com/NandhaKishorM/laya/blob/main/notebooks/laya_finetune_typed_decisions_2xT4_kaggle.ipynb). The rows hold your prompts and commands as written, so keep the dataset private.

To cut the latency tail, hosted calls send one duplicate request at 1000 ms (or at once, after a fast failure) and use the first answer back. Self-hosted calls aren't duplicated.

## Configuration

Every setting except `JEVIS_HOME` can live in `~/.jevis/config.json`, keyed by its name. The environment wins over the file, so `JEVIS_DISABLE=1` in one terminal turns Jevis off there. Keys belong in `~/.jevis/secrets/`, not the config. A file that isn't valid JSON is ignored whole; an invalid setting is ignored on its own. `doctor` names either.

| Variable | Default | What it does |
|---|---|---|
| `JEVIS_MODE=shadow` | off | Log what would happen, change nothing |
| `JEVIS_DISABLE=1` | off | Turn Jevis off |
| `JEVIS_NUDGES=off` | on | Turn all tips off |
| `JEVIS_SCOPE` | everywhere | Folders (`:`-separated; `;` on Windows) Jevis acts in |
| `JEVIS_CRITIC` | `claude` | Who reviews visual work: `claude`, `codex`, or `off` |
| `JEVIS_CRITIC_MODEL` | the CLI's default | The reviewer's model |
| `JEVIS_DESIGN_LAW` | `~/.jevis/design-law.md` | Your design rules for the reviewer |
| `JEVIS_DECIDER` | `jev` | `jev` or `luna` |
| `JEVIS_JEV_URL` | TypeSafe | Any `/v1/systemone` server |
| `JEVIS_JEV_KEY` / `TYPESAFE_API_KEY` | `~/.jevis/secrets/typesafe_api_key` | Jev key; optional for a self-hosted server |
| `JEVIS_JEV_MODEL` | `jev-1.14.0` on TypeSafe | Model sent with each Jev call |
| `JEVIS_LUNA_KEY` / `OPENAI_API_KEY` | `~/.jevis/secrets/openai_api_key` | Luna key |
| `JEVIS_LUNA_MODEL` | `gpt-6-luna` | Model sent to OpenAI Decisions |
| `JEVIS_JEV=off` | on | No decision-model calls; local recording still runs |
| `JEVIS_JEV_CHUNK` | 200; 64 self-hosted | Questions per request |
| `JEVIS_TIMEOUT_MS` | 1500 tool, 3000 stop | How long a hook waits for the decision model |
| `JEVIS_WIKI` | Jevis's `wiki/`, `~/.jevis/wiki`, trusted `.jevis/wiki` | Absolute lesson folders, later ones winning; replaces the defaults |
| `JEVIS_WORKER_MARKER` | `You were called by another agent. Do this task yourself.` | Phrase that marks a worker session |
| `JEVIS_RECORD=off` | on | Don't keep `~/.jevis/jev/calls.jsonl` |
| `JEVIS_PRICE_IN`, `JEVIS_PRICE_OUT` | unset | USD per million tokens, so `jevis cost` shows dollars |
| `JEVIS_HOME` | `~/.jevis` | Where state, logs, backups, and keys live (environment only) |

## See what it's doing

```sh
node bin/jevis.mjs doctor              # the installation, end to end, with a fix for anything wrong
node bin/jevis.mjs stats               # what fired in your sessions, and decision-model latency
node bin/jevis.mjs stats --near        # each lesson against recorded answers: fires and near misses
node bin/jevis.mjs cost --since 7d     # decision-model calls and tokens per day and hook
node bin/jevis.mjs replay <session>    # dry-run a recorded Claude Code or Codex session
```

To see exactly what an agent would get, run a hook by hand:

```sh
echo '{"session_id":"try","model":"gpt-6-sol"}' | node bin/jevis.mjs hook session
```

To judge whether each tip earns its place, have an agent follow [`skills/jevis-improve/SKILL.md`](skills/jevis-improve/SKILL.md): `Read ~/code/jevis/skills/jevis-improve/SKILL.md and review the last 7 days.` It writes a report and a proposed diff to `~/.jevis/proposals/<date>/` and applies nothing.

If the decision model fails three times in a row within ten minutes, the agent sees one line, "Jevis is unavailable right now.", once per session. Errors never reach the agent; they stay in the log and in `doctor`.

## Other harnesses

The installer handles Claude Code and Codex. For anything else, add the hooks by hand.

### Claude Code and Codex, by hand

Claude Code reads the `hooks` key of `~/.claude/settings.json`; Codex reads `~/.codex/hooks.json`. Codex treats `apply_patch` as `Edit`/`Write`.

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "node ~/code/jevis/bin/jevis.mjs hook session", "timeout": 10 }] }],
    "PostCompact": [{ "hooks": [{ "type": "command", "command": "node ~/code/jevis/bin/jevis.mjs hook session", "timeout": 10 }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "node ~/code/jevis/bin/jevis.mjs hook prompt", "timeout": 10 }] }],
    "PreToolUse": [{ "matcher": "^(Bash|Edit|Write|MultiEdit|NotebookEdit|mcp__.*)$", "hooks": [{ "type": "command", "command": "node ~/code/jevis/bin/jevis.mjs hook tool", "timeout": 10 }] }],
    "PostToolUse": [{ "matcher": "^(Bash|Edit|Write|MultiEdit|NotebookEdit|mcp__.*)$", "hooks": [{ "type": "command", "command": "node ~/code/jevis/bin/jevis.mjs hook post", "timeout": 10 }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "node ~/code/jevis/bin/jevis.mjs hook stop", "timeout": 420 }] }]
  }
}
```

Claude Code also takes the `hook post` command under `PostToolUseFailure`, with the same matcher.

### Muse Code

Muse Code sends the same hook payloads with its own tool names. Use the commands above in `~/.config/muse/settings.json`, with the tool matcher `^(bash|edit_file|write_file|apply_patch|mcp__.*)$`.

### Gemini CLI and Antigravity CLI

These use an adapter, `bin/google-hook.mjs`. Replace `<repo>` with the absolute path to your checkout, and merge these into your existing config. Gemini CLI timeouts are in milliseconds; Antigravity's are in seconds.

Gemini CLI, under `hooks` in `~/.gemini/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "node \"<repo>/bin/google-hook.mjs\" gemini-cli SessionStart", "timeout": 10000 }] }],
    "BeforeAgent": [{ "hooks": [{ "type": "command", "command": "node \"<repo>/bin/google-hook.mjs\" gemini-cli BeforeAgent", "timeout": 10000 }] }],
    "BeforeTool": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "node \"<repo>/bin/google-hook.mjs\" gemini-cli BeforeTool", "timeout": 10000 }] }],
    "AfterTool": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "node \"<repo>/bin/google-hook.mjs\" gemini-cli AfterTool", "timeout": 10000 }] }],
    "AfterAgent": [{ "hooks": [{ "type": "command", "command": "node \"<repo>/bin/google-hook.mjs\" gemini-cli AfterAgent", "timeout": 420000 }] }]
  }
}
```

Antigravity CLI, in `~/.gemini/config/hooks.json` (or `.agents/hooks.json` for one workspace). This file has no `hooks` wrapper:

```json
{
  "jevis": {
    "SessionStart": [{ "type": "command", "command": "node \"<repo>/bin/google-hook.mjs\" antigravity SessionStart", "timeout": 10 }],
    "PreInvocation": [{ "type": "command", "command": "node \"<repo>/bin/google-hook.mjs\" antigravity PreInvocation", "timeout": 10 }],
    "PreToolUse": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "node \"<repo>/bin/google-hook.mjs\" antigravity PreToolUse", "timeout": 10 }] }],
    "PostToolUse": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "node \"<repo>/bin/google-hook.mjs\" antigravity PostToolUse", "timeout": 10 }] }],
    "Stop": [{ "type": "command", "command": "node \"<repo>/bin/google-hook.mjs\" antigravity Stop", "timeout": 420 }]
  }
}
```

These adapters have protocol tests but haven't been tried in live authenticated sessions. `/hooks panel` (Gemini) and `/hooks` (Antigravity) show what loaded.

### A new harness

A harness that speaks the same JSON-on-stdin protocol should work as is. One with a different protocol needs an adapter in `src/context.mjs` (`harnessOf` and the transcript reader) and `src/hooks.mjs` (output format).

### The Codex plugin

This repository is also a Codex plugin (`plugin.json`, `hooks/hooks.json`, marketplace in `.agents/plugins/`). It calls the same CLI. Use it *instead of* the installer for Codex, never both, or every hook runs twice:

```sh
node bin/install.mjs --harness codex --uninstall   # if you installed the standard way first
codex plugin marketplace add ~/code/jevis
codex plugin add jevis@jevis-local
```

Then open `/hooks` in a new Codex session and trust Jevis's six hooks. `doctor` doesn't check plugin installs; `jevis stats` shows whether they're firing. The plugin's commands are quoted for macOS and Linux only, so use the installer on Windows.

## Evidence

The current tips haven't been through a controlled evaluation yet. The numbers below measured **Jevis v1**, which injected model-chosen notes on every message and had a model judge every turn ending. A month of real use didn't reproduce a net benefit for either, and both were retired. They're here for what they show about the design review and the cost of checking work.

On Sep 27–28 2026, 9 tasks (3 web pages, 6 engineering) ran bare and with Jevis, in both Codex (GPT-6 Sol) and Claude Code (Opus 5.5). A simulated user wrote follow-ups, a blind judge compared each pair, and hidden checks tested the result.

- **Where Jevis acted, it mostly won:** 20 wins, 6 losses, 1 tie across 27 pairs. Design pages went 10–2, engineering 10–4. Jevis caused no new hidden-check failures.
- **The judge is noisy:** in the 9 pairs where Jevis did nothing, it still picked one side 5–1.
- **It takes longer:** a median 1.56× the bare time, 2.2–2.6× on design. Almost none of that is Jevis (hook calls took about half a second each); it's the agent checking its work and fixing what the review sent back. `--critic off` removes most of it.
- **It narrows the gap between models, without closing it:** bare Codex lost to bare Claude Code 1–5; Codex with Jevis beat bare Claude Code 4–2.

The evaluation is small: one seed of most tasks and a model as the judge. There are no SWE-bench or Terminal-Bench numbers. The best test is your own work: run in shadow mode for a few days, then read `jevis stats`. To rerun the simulations: `node eval/sim.mjs`, then `node eval/sim-report.mjs <summary.json>`. [`docs/flow.html`](docs/flow.html) walks through each hook.

## Which coding model to use

Jevis works with any model. The maintainer's ranking from daily use, as of 28 September 2026, best first:

| Model | Harness | Take |
|---|---|---|
| Claude Opus 5.5 | Claude Code | The best available, and cheaper than Fable 5.1 |
| GPT-6 Astra | Codex | Better than Sol, including at design, but slower and costlier |
| Claude Fable 5.1 | Claude Code | Strong, but Opus 5.5 is better and cheaper |
| GPT-6 Sol | Codex | Faster and cheaper than Astra, less capable |

Jevis made the biggest difference to GPT-6 Sol and GPT-6 Luna. Gemini models, including Gemini 3.8 Flash, aren't recommended: they tend to reread the same files and drift off the task.

<details>
<summary>The full tier list</summary>

| Tier | Models |
|---|---|
| SSS | Claude Opus 5.5 |
| SS | GPT-6 Astra |
| S | Claude Fable 5.1, GPT-6 Sol |
| A | Claude Opus 5, Claude Fable 5, GPT-5.6 Sol, Kimi K3, Grok 4.6, Qwen3.8 Max 0902, GLM-5.3, GPT-6 Luna, Muse Spark 1.3, DeepSeek V4.1 Flash, Hy-4 Preview, Grok 4.7 |
| B | GPT-5.6 Terra, Qwen3.8-Flash-Next, GLM-5.3 Flash, Claude Sonnet 5, K2 Horizon 375B A23B |
| C | GPT-5.6 Luna, Grok 4.5, Qwen3.8 27B, Muse Spark 1.2, MiMo V2.5 Pro, Hy-3, MiniMax-M3 |
| D | Thinking Machines Inkling, Nemotron 3 Ultra, Muse Glimmer |
| E | Claude Haiku 4.5, Mistral Medium 3.5, Nemotron 3.5 Lightning |
| Below E | Gemini 3.8 Flash, Gemini 3.7 Flash, Gemini 3.6 Flash, Gemini 3.5 Flash |

</details>

## Privacy

- **Tips send nothing anywhere.** They're chosen locally.
- **The decision model** (TypeSafe, OpenAI, or your server) receives the user's message, the command or the lines an edit adds, the final message, and file names, as written. Jevis doesn't filter secrets out; you and your harness decide what an agent sees.
- **The design reviewer** (the `claude` or `codex` CLI you already use) receives screenshots, frames, and the request.
- **Everything else stays in `~/.jevis`**, readable only by you: session state, logs, config backups, and the record of decision-model calls. Set `JEVIS_RECORD=off` if you won't train a local model on that record.

## Contributing

Tips and lessons with evidence, harness adapters, and benchmark runs are all welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers setup, what a change needs to be merged, and how to keep private session details out of the repo.

## License

MIT. See [LICENSE](LICENSE). Jevis grew out of an earlier private hook system, which some `source:` fields cite.
