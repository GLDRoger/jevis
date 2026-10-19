# Tips

Tips live in [`nudges/`](../nudges/), one Markdown file each. The frontmatter says when the tip is shown (`hook:`) and, optionally, which model family sees it (`family: gpt`, `claude`, or `other` for every model outside those two). The body is what the agent reads, cut at 1,500 characters.

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

## Worker sessions

Sessions started by another agent make no decision-model or external calls. Jevis recognises a worker by the phrase "You were called by another agent. Do this task yourself." in the first prompt (case-insensitive; `JEVIS_WORKER_MARKER` changes it), an agent-origin prefix, or environment markers such as `AGENT_CALL_DEPTH`. Workers keep the session tips and get the worker tip on every message (no one can answer questions, so make the call and list assumptions). They get no feedback tips and no design review. Their log rows carry `worker: true`.

## It fails open

With no key, a timeout, a broken settings file, or a moved checkout, the agent carries on as if Jevis weren't there. `jevis doctor` tells that apart from "nothing applied".
