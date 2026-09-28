# Contributing to Jevis

Thanks for helping. The most useful contributions, roughly in order:

1. **Lessons.** A wiki entry for a failure you keep seeing from your coding agent, backed by real sessions.
2. **Design telltales.** A new `slop/` refusal, with the edits it must catch and the look-alikes it must let through.
3. **Evidence.** Jevis has no public benchmark numbers yet. A SWE-bench, Terminal-Bench, or similar run with and without Jevis is very welcome, and so is a Laya checkpoint fine-tuned on Jevis's questions.
4. **Harness adapters.** Support for an agent harness beyond Codex and Claude Code (see "Other agent harnesses" in the README).
5. **Bug fixes**, especially anywhere a hook breaks, stalls, or blocks an agent wrongly.

For a large change, open an issue first so we can agree on the shape before you build it.

## Set up

You need Node 22 or newer.

```sh
git clone https://github.com/GLDRoger/jevis.git
cd jevis
npm ci
npm test        # offline: a scripted decision model stands in for Jev
npm run lint    # checks every wiki entry against WIKI.md
```

Both run in CI on every pull request and must pass before merging.

Live checks (`node bin/jevis.mjs ask`, `node eval/slop.mjs`, the simulations) call the decision model, so they need a TypeSafe key or a self-hosted server (see the README). CI doesn't run them. When your change depends on them, paste their output into the pull request.

## Adding or changing a lesson

[WIKI.md](WIKI.md) is the authoring guide, and [skills/jevis/SKILL.md](skills/jevis/SKILL.md) walks an agent through the same process. You can point your agent at it. A lesson gets merged when:

- **It is one failure,** asked as one literal yes/no question that names the state field it reads.
- **It has evidence.** `source:` says where the lesson came from: how many sessions, when, and the user's own words where they help. Anonymize it before you commit (see [Privacy](#privacy)).
- **Refusals are careful.** A `deny` or `block` uses `min: 0.85` or higher, plus an `unless` that asks whether the user asked for exactly this.
- **It is shown to work.** In the pull request, paste `jevis ask` output for at least one case that should fire and two look-alikes that shouldn't.
- **Family-specific lessons are marked.** A lesson that fixes a habit of Claude models or of GPT models carries `family: claude` or `family: gpt`. Leave the field out for lessons every model needs.

For a `slop/` entry, also add its cases to `eval/slop-cases.mjs`: the telltale edit, plus the look-alikes that must pass. Then run `node eval/slop.mjs` and paste the final score. Every existing case must stay right.

A lesson that only fits your taste belongs in your own `~/.jevis/wiki/`, not here. The shipped wiki is for failures most users of that model would want caught.

## Changing code

- Add a test beside the existing ones in `tests/`. A fix should come with a test that fails without it.
- **A hook must never break the agent.** Errors, timeouts, and a missing key all fail open. Keep it that way.
- **Stay inside the time budgets:** 3 s for a prompt hook, 1.5 s for a tool hook, 3 s for a stop hook. Anything slower runs on every command the agent makes.
- **Keep dependencies minimal.** Jevis has one runtime dependency, `playwright-core`. Explain any new one in the pull request.
- **Update the docs your change touches:** a new state fact or axis goes in `WIKI.md`, and a new setting goes in the README's configuration table.

## Pull requests

`main` accepts changes only through pull requests, and every pull request is squash-merged, so its title becomes the commit message. Write the title as a [Conventional Commit](https://www.conventionalcommits.org): `feat: …`, `fix: …`, `docs: …`, `test: …`. Keep the description short:

- **Why:** the problem, in one or two lines.
- **How:** what you changed.
- **Tests:** the commands you ran and their results, including any live output.

## Privacy

Lessons come from real sessions, and real sessions hold private material. Before you commit, remove anything that identifies a person, client, or project:

- names, emails, and handles;
- session ids, rollout file names, and local paths;
- prices, rates, and internal URLs;
- API keys, tokens, and anything else in `~/.jevis/`.

Keep only what shows the failure, such as counts, dates, and a short quote with the private parts replaced by `[a client]` or `[a private repo]`.

Never commit `~/.jevis/jev/calls.jsonl`, session transcripts, or eval output from your own sessions.

## Security

Report vulnerabilities privately, as [SECURITY.md](SECURITY.md) describes, not in a public issue.

## License

By contributing, you agree that your contribution is licensed under the [MIT License](LICENSE).
