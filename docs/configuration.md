# Configuration

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

## Settings

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

To judge whether each tip earns its place, have an agent follow [`skills/jevis-improve/SKILL.md`](../skills/jevis-improve/SKILL.md): `Read ~/code/jevis/skills/jevis-improve/SKILL.md and review the last 7 days.` It writes a report and a proposed diff to `~/.jevis/proposals/<date>/` and applies nothing.

If the decision model fails three times in a row within ten minutes, the agent sees one line, "Jevis is unavailable right now.", once per session. Errors never reach the agent; they stay in the log and in `doctor`.
