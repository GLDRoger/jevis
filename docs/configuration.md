# Configuration

## Installer

```sh
node bin/install.mjs [flags]
```

| Flag | Effect |
| --- | --- |
| `--dry-run` | Print planned edits without writing |
| `--harness claude` / `--harness codex` | Install one harness (default: both `~/.claude/settings.json` and `~/.codex/hooks.json`) |
| `--critic off` / `--critic codex` / `--critic claude` | Pick the [design review](#the-design-review) reviewer (`claude` default) |
| `--shadow` / `--live` | Log decisions without injecting anything, or go back live ([limits](evidence.md#judging-it-on-your-own-work)) |
| `--decider luna` / `--decider jev` | Choose the [decision model](#the-decision-model) |
| `--jev-url <url>` / `--jev-url typesafe` | Point at a self-hosted decision server, or back to TypeSafe |
| `--uninstall` | Remove Jevis's hooks |

Flags persist in `~/.jevis/config.json`. Modified files are backed up to `~/.jevis/backups/<time>/`, unrelated hooks stay untouched, and running install twice is idempotent. `--uninstall` keeps `~/.jevis` (keys, logs, backups).

Keep this checkout where you installed it — hooks invoke its absolute path. Update with `git pull && npm ci`; if you move the clone, rerun the installer.

## The design review

On by default; turn it off with `node bin/install.mjs --critic off` if you just want tips.

When a visual turn (page, component, or canvas film) claims it's done, Jevis renders it in headless Chrome at 1440px and 390px (plus dark mode if defined). For films, it samples frames across the runtime (via `renderAt(t)` / `FILM.draw`, or real-time up to 40s) and checks soundtrack loudness/spectrogram if `ffmpeg` is present. A second model reviews the screenshots cold and either says `"ship"` or returns up to 5 `"Now: A. Instead: X."` fixes, sending the agent back (up to 2 rounds on the first reviewed turn, 1 after).

| Flag | Reviewer | Needs |
| --- | --- | --- |
| default | Claude (`claude` CLI) | Chrome, signed-in `claude`, decision model |
| `--critic codex` | Codex (`codex` CLI) | Chrome, signed-in `codex`, decision model |
| `--critic off` | none | nothing |

Two models participate:
- **Decision model:** checks whether the turn actually finished visual work (skips progress updates). Runs whenever review is on and files changed, so having a key enables it.
- **Reviewer:** runs via your local CLI (240s per round, 420s Stop timeout; usually 30–90s). Override the model with `JEVIS_CRITIC_MODEL`.

**What the reviewer sees:** your latest and opening prompts, changed filenames, rendered URLs/paths, render facts (like mobile overflow), and screenshots from `~/.jevis/reviews/`. Claude runs `claude -p` read-only with access to the screenshot dir and your design-rules dir (if your rules live at `~/.jevis/design-law.md`, that grants read access to `~/.jevis` — move the file and point `JEVIS_DESIGN_LAW` at it if you'd rather isolate it from your keys/logs). Codex runs `codex exec` in its read-only sandbox with screenshots attached.

**Design rules lookup order:** `JEVIS_DESIGN_LAW`, `~/.jevis/design-law.md`, `~/.claude/slop.md`, `~/.codex/slop.md`.

## The decision model

Fixed tips and the pass-claim Stop check are pure code and need no decision model. You only need one for the design review or custom [lessons](../WIKI.md).

- **TypeSafe Jev (default, `jev-1.14.0`):** grab a key at [console.typesafe.ai](https://console.typesafe.ai) and save it with `chmod 600` (or export `TYPESAFE_API_KEY`):
  ```sh
  mkdir -p ~/.jevis/secrets && chmod 700 ~/.jevis ~/.jevis/secrets
  printf '%s' 'YOUR_KEY' > ~/.jevis/secrets/typesafe_api_key && chmod 600 ~/.jevis/secrets/typesafe_api_key
  ```
- **GPT-6 Luna:** uses OpenAI's [Decisions API](https://developers.openai.com/api/docs/guides/decisions). Save your key to `~/.jevis/secrets/openai_api_key` (or `JEVIS_LUNA_KEY` / `OPENAI_API_KEY`) and install with `--decider luna`. Thresholds were tuned on Jev (on the old tool battery Luna caught 24/34 vs Jev's 30/34), so test in shadow mode with `node bin/jevis.mjs stats --near` if switching.
- **Self-hosted:** any server implementing TypeSafe's `POST /v1/systemone` works (e.g. [Laya](https://github.com/NandhaKishorM/laya)): `node bin/install.mjs --jev-url http://127.0.0.1:8000/v1/systemone`. Stock Laya checkpoints didn't separate my questions (0/35 catches, 4.2s/call on laptop), so fine-tune first using `node bin/jevis.mjs export` and Laya's [fine-tuning notebook](https://github.com/NandhaKishorM/laya/blob/main/notebooks/laya_finetune_typed_decisions_2xT4_kaggle.ipynb). Keep exported datasets private — they contain raw prompts and commands.

Hosted calls hedge after 1000ms (or immediately on fast error) to cut tail latency; self-hosted calls don't hedge. Hooks wait at most 1.5s on tool calls and 3s on stop, then fail open. Three failures in a row within 10 minutes surface `"Jevis is unavailable right now."` once per session; everything else stays in the log.

## Settings

Any variable except `JEVIS_HOME` can go in `~/.jevis/config.json` (e.g. `{ "JEVIS_CRITIC": "off" }`). Environment variables override the file. Keep keys in `~/.jevis/secrets/`, not in `config.json`. Invalid JSON or values are ignored and flagged by `doctor`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `JEVIS_MODE=shadow` | off | Log decisions without sending anything to the agent ([limits](evidence.md#judging-it-on-your-own-work)) |
| `JEVIS_DISABLE=1` | off | Disable Jevis completely |
| `JEVIS_NUDGES=off` | on | Disable all tips |
| `JEVIS_SCOPE` | everywhere | `:`-separated (`;` on Windows) folder allowlist |
| `JEVIS_CRITIC` | `claude` | Visual reviewer: `claude`, `codex`, or `off` |
| `JEVIS_CRITIC_MODEL` | CLI default | Reviewer model override |
| `JEVIS_DESIGN_LAW` | `~/.jevis/design-law.md` | Design rules file for the reviewer |
| `JEVIS_DECIDER` | `jev` | `jev` or `luna` |
| `JEVIS_JEV_URL` | TypeSafe | Any `/v1/systemone` endpoint |
| `JEVIS_JEV_KEY` / `TYPESAFE_API_KEY` | `~/.jevis/secrets/typesafe_api_key` | Jev API key (optional for self-hosted) |
| `JEVIS_JEV_MODEL` | `jev-1.14.0` on TypeSafe | Jev model name |
| `JEVIS_LUNA_KEY` / `OPENAI_API_KEY` | `~/.jevis/secrets/openai_api_key` | OpenAI key for Luna |
| `JEVIS_LUNA_MODEL` | `gpt-6-luna` | Model sent to OpenAI Decisions |
| `JEVIS_JEV=off` | on | Skip decision-model calls (state + event logs still run) |
| `JEVIS_JEV_CHUNK` | 200 (64 self-hosted) | Questions per request |
| `JEVIS_TIMEOUT_MS` | 1500 tool / 3000 stop | Decision-model hook timeout |
| `JEVIS_WIKI` | `wiki/`, `~/.jevis/wiki`, trusted `.jevis/wiki` | Replace default lesson folders (`:` / `;` separated) |
| `JEVIS_WORKER_MARKER` | `You were called by another agent. Do this task yourself.` | Worker session phrase |
| `JEVIS_RECORD=off` | on | Stop recording full call payloads in `~/.jevis/jev/` (`log.jsonl` still writes) |
| `JEVIS_PRICE_IN`, `JEVIS_PRICE_OUT` | unset | USD per 1M tokens for `cost` |
| `JEVIS_HOME` | `~/.jevis` | State/logs/keys root (env only) |

## Files Jevis keeps

Everything stays under `~/.jevis/` (`700` dirs, `600` files on macOS/Linux). `--uninstall` leaves it alone so you keep your logs and backups; delete it manually if you want a clean wipe.

| Path | Holds |
| --- | --- |
| `config.json` | Saved settings |
| `secrets/` | API keys |
| `nudges/`, `wiki/`, `design-law.md` | Your tip overrides, custom lessons, and design rules |
| `trusted.json` | Trusted repo `.jevis/wiki` content hashes |
| `sessions/` | Per-session state (current prompt, turn, shown tips, command exits) |
| `log.jsonl` | Hook event log (up to 200 chars of prompt/command/message + fired tip ids; grows fast under heavy use) |
| `jev/calls.jsonl`, `jev/questions/` | Decision-model payloads, scores, latency, and tokens (`JEVIS_RECORD=off` stops these) |
| `reviews/` | Design-review screenshots |
| `backups/` | Pre-install backups of harness configs |
| `jev-health.json` | Recent decision-model failure streak |
| `proposals/`, `export/` | Output of `jevis-improve` and `export` |

## Cost and privacy

- **Tips:** chosen locally, zero network calls. Context cost is ~3.5 KB at session start/compaction, ~0.2 KB per message (~0.5 KB for GPT), and a line or two on tool triggers.
- **Decision model:** only called for the design review gate and custom lessons. Sends raw prompts, commands/added lines, filenames, and final messages without redaction — so anything typed into a command goes to the decider and `jev/calls.jsonl`. Set `JEVIS_PRICE_IN`/`JEVIS_PRICE_OUT` to have `node bin/jevis.mjs cost` print dollar totals.
- **Reviewer:** runs on your local `claude` or `codex` CLI plan.
- **Workers:** zero decision-model or reviewer calls.

## See what it's doing

```sh
node bin/jevis.mjs doctor              # end-to-end health check with fixes
node bin/jevis.mjs stats               # decision-model volume, latency, and fired lessons
node bin/jevis.mjs stats --near        # fires vs near-misses across recorded answers
node bin/jevis.mjs cost --since 7d     # decision-model calls and tokens per day
node bin/jevis.mjs replay <session>    # dry-run lessons over a recorded session
```

`stats` and `cost` track only decision-model/lesson activity. Count tips directly from `log.jsonl`:

```sh
jq -r 'select(.event == "nudge") | .ids[]' ~/.jevis/log.jsonl | sort | uniq -c | sort -rn
```

To audit whether your tips are actually earning their keep, ask an agent: `Read ~/code/jevis/skills/jevis-improve/SKILL.md and review the last 7 days.` It inspects logs and transcripts, writes a proposal to `~/.jevis/proposals/<date>/`, and edits nothing itself.
