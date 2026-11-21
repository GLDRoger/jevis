# Jevis

Jevis is a lightweight set of hooks for coding agents. At key moments in a session — start, every message, and right before certain commands — it drops a short reminder into the agent's context.

Tips live in plain Markdown files you can read, edit, or turn off. Code picks them locally: no API key, no network call.

Example — an agent is about to run `grep -rn TODO src`:
- **Without Jevis:** `grep` runs as normal.
- **With Jevis:** the command still runs, and the agent gets: *"Search with `rg` instead of `grep` and `fd` instead of `find`: they are installed here, faster, and respect `.gitignore`."*

Jevis never blocks a tool call or an edit. It only sends the agent back in two cases: when its final message claims checks pass even though a check failed after the last edit, or when the optional visual design review spots real fixes. See [Tips and hooks](docs/tips.md) for every hook and tip.

**Honest note on evidence:** the current fixed tips replaced an earlier LLM-heavy version (v1) that turned out noisy and expensive. I haven't formally benchmarked the new tips yet — see [Evidence](docs/evidence.md) for what was measured in v1 and how to judge Jevis on your own work.

## Install

Requires Node 22+. The installer handles Claude Code and Codex; Gemini CLI, Antigravity, and Muse Code are [wired by hand](docs/harnesses.md).

```sh
git clone https://github.com/GLDRoger/jevis.git ~/code/jevis
cd ~/code/jevis && npm install
node bin/install.mjs --critic off --dry-run   # preview changes to ~/.claude/settings.json and ~/.codex/hooks.json
node bin/install.mjs --critic off             # install (backs up old configs to ~/.jevis/backups/)
node bin/jevis.mjs doctor                     # verify everything
```

`--critic off` is the cleanest starting point: fixed tips + the end-of-turn pass-claim check, with zero API keys or external calls. Leave off `--critic off` if you want the automated visual [design review](docs/configuration.md#the-design-review) (defaults to Claude as reviewer). Hooks activate on your next session; Codex asks you to approve them once.

## Docs

- [Tips and hooks](docs/tips.md) — every hook moment, every shipped tip, overriding tips, and worker sessions.
- [Configuration](docs/configuration.md) — installer flags, design review, decision model, env vars, files, cost, and inspection commands.
- [Other harnesses](docs/harnesses.md) — Gemini CLI, Antigravity, Muse Code, the Codex plugin, manual setup, and Windows.
- [Writing lessons](WIKI.md) — custom content-aware checks for commands, edits, or turn endings.
- [Evidence](docs/evidence.md) — v1 audit numbers, simulation results, and how to test Jevis on your own work.
- [Beast and Jevis](https://github.com/GLDRoger/beast/blob/main/docs/layers.md) — how Jevis pairs with Beast's standing instruction files.
- [Overview page](https://github.com/GLDRoger/jevis/blob/main/docs/index.html) — single-page HTML summary with every shipped tip.

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [LICENSE](LICENSE) (MIT).
