# Jevis

Jevis is a set of hooks for coding agents. At set moments in a session, it adds a short tip to what the agent reads: when the session starts, with each message, and before certain commands. Code picks each tip from a Markdown file you can read, edit, or switch off. Tips need no API key, and Jevis makes no network calls for them. The tip text joins the agent's context, which the harness sends to its model provider along with the rest of the conversation.

For example, an agent is about to run `grep -rn TODO src`:

- **Without Jevis**, the command just runs.
- **With Jevis**, the command still runs unchanged, and the agent also reads: "Search with `rg` instead of `grep` and `fd` instead of `find`: they are installed here, faster, and respect `.gitignore`."

Jevis never refuses a tool call or an edit. It sends the agent back in only two cases: a final message that says checks pass while a check run after the last edit failed on its latest run, and an optional design review. [Tips and hooks](docs/tips.md) covers every moment and every tip.

**Evidence:** the current tips haven't been measured. They replaced an earlier version that a month-long audit found costly and mostly ineffective. [Evidence](docs/evidence.md) separates what was measured from what is only expected, and explains how to judge Jevis on your own work.

## Install

You need Node 22 or newer. Jevis installs into Claude Code and Codex. Gemini CLI, Antigravity, and Muse Code are [set up by hand](docs/harnesses.md).

```sh
git clone https://github.com/GLDRoger/jevis.git ~/code/jevis
cd ~/code/jevis && npm install
node bin/install.mjs --critic off --dry-run   # shows the changes to ~/.claude/settings.json and ~/.codex/hooks.json
node bin/install.mjs --critic off             # installs; old configs are backed up in ~/.jevis/backups/
node bin/jevis.mjs doctor                     # checks the setup
```

With only the shipped tips and lesson, `--critic off` gives the simplest setup: tips and the end-of-turn check, with no key or decision-model calls. Custom lessons can still make calls. Without the flag, the design review is on, with Claude as the reviewer ([the design review](docs/configuration.md#the-design-review)). Hooks take effect in new sessions, and Codex asks you to approve them once. Other flags, removal, and settings are in [Configuration](docs/configuration.md).

## Docs

- [Tips and hooks](docs/tips.md): what happens at each moment, every tip, changing or adding tips, and worker sessions.
- [Configuration](docs/configuration.md): installer flags, the design review, the decision model, settings, files, cost and privacy, and commands that show what Jevis is doing.
- [Other harnesses](docs/harnesses.md): Gemini CLI, Antigravity, Muse Code, the Codex plugin, manual setup, and Windows.
- [Writing lessons](WIKI.md): checks that depend on what a command, an edit, or a final message contains.
- [Evidence](docs/evidence.md): what has and hasn't been measured.
- [Beast and Jevis](https://github.com/GLDRoger/beast/blob/main/docs/layers.md): how Jevis fits with the Beast instruction files.
- [Overview page](https://github.com/GLDRoger/jevis/blob/main/docs/index.html): a one-page summary with every shipped tip. Open `docs/index.html` from your clone in a browser.

[CONTRIBUTING.md](CONTRIBUTING.md) covers development, and [SECURITY.md](SECURITY.md) covers reporting vulnerabilities. MIT, see [LICENSE](LICENSE).
