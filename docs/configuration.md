# Configuration

## Installer

```sh
node bin/install.mjs [flags]
```

| Flag | Effect |
|---|---|
| `--dry-run` | Print the changes, write nothing |
| `--harness claude` or `--harness codex` | One harness; the default is both (`~/.claude/settings.json`, `~/.codex/hooks.json`) |
| `--critic off`, `--critic codex`, `--critic claude` | Choose the [design review](#the-design-review) reviewer; `claude` is the default |
| `--shadow`, `--live` | Log decisions without changing sessions, or go back ([limits](evidence.md#judging-it-on-your-own-work)) |
| `--decider luna`, `--decider jev` | Choose the [decision model](#the-decision-model) |
| `--jev-url <url>`, `--jev-url typesafe` | Use a self-hosted decision model, or go back to TypeSafe |
| `--uninstall` | Remove Jevis's hooks |

The installer saves its options in `~/.jevis/config.json`, so they last until you change them. It backs up each file it changes to `~/.jevis/backups/<time>/`, leaves other hooks as they are, and gives the same result when run twice. Hooks take effect in new sessions, and Codex asks you to approve new hooks once. `--uninstall` leaves `~/.jevis` in place, including keys, logs, and backups.

Keep the checkout: hooks call its absolute path. To update, run `git pull` and `npm ci` there; the next hook uses the updated code. If you move the checkout, rerun the installer from its new location. Your settings and overrides in `~/.jevis` stay separate.

## The design review

The design review is optional, and on by default. Turn it off with `node bin/install.mjs --critic off` unless you want it.

After a turn of visual work (a page, a component, or a film) that says it's finished, Jevis renders the result in headless Chrome at 1440 and 390 px, plus dark mode if the page has one. For a film, it samples frames: across the whole runtime when the film exposes a render hook, otherwise from the first 40 seconds of playback. If there's a rendered video and `ffmpeg` is installed, it adds a spectrogram and loudness figures, and warns when the video is older than its source. A second model then reviews the screenshots as a designer who didn't make the work. It answers "ship", or gives up to five fixes in the form "Now: A. Instead: X.", and the agent is sent back with them. The first reviewed turn of a session gets two rounds, and later turns get one.

| Install with | Who reviews | Needs |
|---|---|---|
| nothing (default) | Claude, through the `claude` CLI | Chrome, `claude` signed in, a decision model |
| `--critic codex` | Codex, through the `codex` CLI | Chrome, `codex` signed in, a decision model |
| `--critic off` | nobody | nothing |

Two models take part:

- **The decision model** decides whether a turn should be reviewed at all: was work requested, does the final message say it's done, and is it visual. Progress reports ("the workers are still rendering") aren't reviewed. Jevis asks this whenever the review is on and the turn changed files, before it checks for Chrome or the reviewer CLI. So a key alone is enough to start these calls.
- **The reviewer** runs on your own plan through its CLI, one invocation per round, with up to 240 s each. The Stop hook's timeout is 420 s, and a round usually takes 30 to 90 s. `JEVIS_CRITIC_MODEL` picks the reviewer's model.

**What the reviewer gets.** The user's latest request and the first request of the conversation, the names of the changed files, the rendered URLs or paths, facts from rendering (such as sideways overflow on a phone), and the screenshots, which are saved in `~/.jevis/reviews/`. The Claude reviewer runs `claude -p` in the project folder with only the Read tool, and with access added to the screenshot folder and to the folder that holds your design rules. If those rules live in `~/.jevis/design-law.md`, that folder is `~/.jevis`, which also holds your keys and logs. If that matters to you, keep the rules file in a folder of its own and point `JEVIS_DESIGN_LAW` at it. The Codex reviewer runs `codex exec` in its read-only sandbox, with the screenshots attached.

**Your design rules.** The reviewer judges against the first of these that exists: `JEVIS_DESIGN_LAW`, `~/.jevis/design-law.md`, `~/.claude/slop.md`, or `~/.codex/slop.md`.

## The decision model

Tips and the end-of-turn check are decided by code and need no decision model. You need one only for the design review and for any [lessons](../WIKI.md) you add. Jevis asks it yes/no questions and reads back a probability for each.

**TypeSafe Jev** is the default (`jev-1.14.0`). Get a key from the [TypeSafe console](https://console.typesafe.ai), and save it where only you can read it:

```sh
mkdir -p ~/.jevis/secrets && chmod 700 ~/.jevis ~/.jevis/secrets
printf '%s' 'YOUR_KEY' > ~/.jevis/secrets/typesafe_api_key && chmod 600 ~/.jevis/secrets/typesafe_api_key
```

You can set `TYPESAFE_API_KEY` in the agent's environment instead.

**GPT-6 Luna** runs through OpenAI's [Decisions API](https://developers.openai.com/api/docs/guides/decisions). Save the key as `~/.jevis/secrets/openai_api_key` the same way, or set `JEVIS_LUNA_KEY` or `OPENAI_API_KEY`, then install with `--decider luna`. Lesson thresholds were tuned on Jev, and Luna spreads its probabilities differently: on the old tool battery, it caught 24 of 34 cases to Jev's 30. If you switch, start in shadow mode and check `node bin/jevis.mjs stats --near`.

**Self-hosted.** Any server that speaks TypeSafe's `POST /v1/systemone` works, with or without a key, such as [Laya](https://github.com/NandhaKishorM/laya): `node bin/install.mjs --jev-url http://127.0.0.1:8000/v1/systemone`. In the maintainer's tests, Laya's checkpoints of the time didn't separate Jevis's questions (0 of 35 catches, 4.2 s per call on a laptop), so fine-tune it first. `node bin/jevis.mjs export` turns your recorded Jev calls into a training set for Laya's [fine-tuning notebook](https://github.com/NandhaKishorM/laya/blob/main/notebooks/laya_finetune_typed_decisions_2xT4_kaggle.ipynb). The rows hold your prompts and commands as written, so keep the dataset private.

To cut the latency tail, hosted calls send one duplicate request at 1000 ms (or at once, after a fast failure) and use whichever answer arrives first. Self-hosted calls aren't duplicated. A hook waits at most 1.5 s for an answer before a tool call and 3 s at the end of a turn, then carries on without it.

If the decision model fails three times in a row within ten minutes, the agent sees "Jevis is unavailable right now." once per session. Other errors never reach the agent. They stay in the log, and `doctor` reports them.

## Settings

Every setting except `JEVIS_HOME` can live in `~/.jevis/config.json`, keyed by its name, as in `{ "JEVIS_CRITIC": "off" }`. The environment wins over the file, so `JEVIS_DISABLE=1` in one terminal turns Jevis off there. Keys belong in `~/.jevis/secrets/`, not in the config file. A file that isn't valid JSON is ignored whole, and an invalid setting is ignored on its own. `doctor` names either problem. The installer saves its flags (`--shadow`, `--critic`, `--decider`, `--jev-url`) in this file.

| Variable | Default | What it does |
|---|---|---|
| `JEVIS_MODE=shadow` | off | Log decisions and send the agent nothing ([limits](evidence.md#judging-it-on-your-own-work)) |
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
| `JEVIS_JEV=off` | on | No decision-model calls or new call records; session state and event logs still run |
| `JEVIS_JEV_CHUNK` | 200; 64 self-hosted | Questions per request |
| `JEVIS_TIMEOUT_MS` | 1500 tool, 3000 stop | How long a hook waits for the decision model |
| `JEVIS_WIKI` | Jevis's `wiki/`, `~/.jevis/wiki`, trusted `.jevis/wiki` | Absolute lesson folders, later ones winning; replaces the defaults |
| `JEVIS_WORKER_MARKER` | `You were called by another agent. Do this task yourself.` | Phrase that marks a worker session |
| `JEVIS_RECORD=off` | on | Don't keep the decision-model call record (`~/.jevis/jev/`); `log.jsonl` is still written |
| `JEVIS_PRICE_IN`, `JEVIS_PRICE_OUT` | unset | USD per million tokens, so `cost` shows dollars |
| `JEVIS_HOME` | `~/.jevis` | Where state, logs, backups, and keys live (environment only) |

## Files Jevis keeps

Everything lives in `~/.jevis/`. On macOS and Linux it's readable only by you (folders 700, files 600). On Windows, Jevis doesn't change permissions, so the folder has whatever access your user profile gives it. `--uninstall` leaves this folder, so delete it yourself to remove keys, logs, and backups.

| Path | Holds |
|---|---|
| `config.json` | Your settings |
| `secrets/` | API keys |
| `nudges/`, `wiki/`, `design-law.md` | Your tips, lessons, and design rules |
| `trusted.json` | Repositories whose `.jevis/wiki` you trusted, pinned to the files' contents |
| `sessions/` | Per-session memory: the current request, turn, which tips were shown, command results |
| `log.jsonl` | One row per hook event, including up to 200 characters of the request, command, or final message, and which tips fired. Always written, and it grows by megabytes a day under heavy use. |
| `jev/calls.jsonl`, `jev/questions/` | Every decision-model call: the state sent, the answers, timing, and token use. `JEVIS_RECORD=off` stops these, and only these. |
| `reviews/` | Design-review screenshots |
| `backups/` | Harness and config files from before each install |
| `jev-health.json` | Recent decision-model failures, for the outage line |
| `proposals/`, `export/` | Output of the `jevis-improve` skill and of `export` |

## Cost and privacy

**Tips** are chosen locally, and Jevis makes no network calls for them. Their text joins the agent's context, so it goes to your model provider with the rest of the conversation. Their cost is that context: about 3.5 KB at session start (and again after a compaction or clear), about 0.7 KB on every message (about 1 KB for GPT models), and a sentence or two when a moment-specific tip fires.

**The decision model** is called only for the design review's yes/no check and for lessons you add. It receives the user's message, the command or added lines of an edit, the final message, and file names, all as written. Nothing is masked first, so a key typed into a command is sent and recorded in `jev/calls.jsonl` as it is. Prices change, so this page quotes none. Set `JEVIS_PRICE_IN` and `JEVIS_PRICE_OUT` from your provider's current price list, and `node bin/jevis.mjs cost` turns recorded token counts into dollars.

**The reviewer** runs through your own `claude` or `codex` CLI and plan, so it's billed and governed like any other session with that CLI. It receives what's listed under [the design review](#the-design-review).

**Worker sessions** (started by another agent) make no decision-model or reviewer calls at all.

## See what it's doing

```sh
node bin/jevis.mjs doctor              # the installation, end to end, with a fix for anything wrong
node bin/jevis.mjs stats               # decision-model events, latency, and which lessons acted
node bin/jevis.mjs stats --near        # each lesson against recorded answers: fires and near misses
node bin/jevis.mjs cost --since 7d     # decision-model calls and tokens per day and hook
node bin/jevis.mjs replay <session>    # dry-run lessons over a recorded Claude Code or Codex session
```

None of these count tips. `stats` reads only lesson and decision-model events, and `cost` covers only decision-model calls, not the context your tips add or what the reviewer CLI spends. Tips are logged as `"event":"nudge"` rows in `log.jsonl`, with the hook and tip ids. To count them:

```sh
jq -r 'select(.event == "nudge") | .ids[]' ~/.jevis/log.jsonl | sort | uniq -c | sort -rn
```

To review whether each tip earns its place, ask an agent to follow [`skills/jevis-improve/SKILL.md`](../skills/jevis-improve/SKILL.md): `Read ~/code/jevis/skills/jevis-improve/SKILL.md and review the last 7 days.` It reads your logs and transcripts, writes a report and a proposed diff to `~/.jevis/proposals/<date>/`, and applies nothing.
