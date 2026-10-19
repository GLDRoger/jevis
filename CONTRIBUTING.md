# Contributing to Jevis

Thanks for helping. The most useful contributions:

1. **Tips** that change what a model does, backed by sessions where it went wrong without them.
2. **Evidence.** A SWE-bench, Terminal-Bench, or similar run with and without Jevis.
3. **Harness adapters** beyond the ones the README lists.
4. **Bug fixes**, especially anywhere a hook breaks, stalls, or sends an agent back wrongly.

For a large change, open an issue first so we can agree on the shape before you build it.

## Set up

You need Node 22 or newer.

```sh
git clone https://github.com/GLDRoger/jevis.git
cd jevis
npm ci
npm test        # offline: a scripted decision model stands in for Jev and Luna
npm run lint    # every lesson against WIKI.md, plus every tip
```

Both run in CI, on Linux, macOS, and Windows, and must pass before merging.

## Adding or changing a tip

A tip is a file in `nudges/` (see the README's [Tips](README.md#tips)). It gets merged when:

- **It changes behaviour.** Show a session where the model went wrong at that moment, and say what the tip would have changed. A tip that restates what models already do is noise on every send.
- **It doesn't contradict instruction files.** A tip may restate a common rule in fewer words. It never adds one that a user's `AGENTS.md` or `CLAUDE.md` would fight.
- **It fits most users.** Taste that's only yours belongs in your own `~/.jevis/nudges/`.
- **It's marked by family** when it fixes one family's habit: `family: claude`, `gpt`, or `other`.

## Adding or changing a lesson

[WIKI.md](WIKI.md) is the guide. A lesson gets merged when it's one failure asked as one literal question, its `source:` gives anonymised evidence, it only adds context (only the code-decided Stop check sends an agent back), and the pull request shows `jevis ask` output for one case that fires and two look-alikes that don't.

`jevis ask`, `replay`, and the simulations call a real decision model, so they need a TypeSafe key, an OpenAI key with `JEVIS_DECIDER=luna`, or a self-hosted server. CI doesn't run them; paste their output into the pull request. A change to how questions are asked should be checked on both Jev and Luna.

## Changing code

- **A hook must never break the agent.** Errors, timeouts, and a missing key all fail open. Keep it that way.
- **Stay inside the time budgets:** 1.5 s for a tool hook and 3 s for a stop hook, before the optional review. Tool hooks run on every command the agent makes.
- **Add a test** beside the existing ones in `tests/`. A fix comes with a test that fails without it.
- **Keep dependencies minimal.** The one runtime dependency is `playwright-core`, for the design review. Explain any new one.
- **Update the docs your change touches:** a new tip moment or setting in the README, a new state fact or axis in WIKI.md.

## Pull requests

`main` accepts changes only through pull requests that pass CI, and every pull request is squash-merged, so its title becomes the commit message. Write the title as a [Conventional Commit](https://www.conventionalcommits.org) (`feat: …`, `fix: …`, `docs: …`). Keep the description short:

- **Why:** the problem, in one or two lines.
- **How:** what you changed.
- **Tests:** the commands you ran and their results.

## Privacy

Tips and lessons come from real sessions, which hold private material. Before you commit, remove names, emails, handles, session ids, local paths, prices, internal URLs, and keys. Keep only what shows the failure, such as counts, dates, and a short quote with private parts replaced by `[a client]` or `[a private repo]`.

Never commit anything from `~/.jevis/`, session transcripts, or eval output from your own sessions.

## Security

Report vulnerabilities privately, as [SECURITY.md](SECURITY.md) describes.

## License

By contributing, you agree that your contribution is licensed under the [MIT License](LICENSE).
