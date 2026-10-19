# Evidence

The current tips started logging on 19 October 2026 and haven't been measured yet. What exists measured **Jevis v1**, which had a model choose notes for every message, refuse design patterns before edits, and judge every turn ending. The best test is your own work: run in shadow mode for a few days, then read `jevis stats`.

## One month of real use (October 2026)

The maintainer ran v1 on every Claude Code and Codex session for a month, then audited the log against the transcripts:

- **Cost:** about $70 in decision-model calls. Prompt notes and model-judged Stop blocks were most of it.
- **Prompt notes** (38 of them) changed nothing the agent did.
- **Model-judged Stop blocks** caught 4 real problems and caused 54 harmful blocks.
- **Design refusals** helped nobody: gradient text 0 helped and 6 harmed, purple gradients 0 and 5, fake app windows 0 and 4. The weakened-tests check was 0 helped and 8 neutral.

All of these were retired. What's left is fixed tips chosen by code, one code-decided Stop check, and the optional design review. Tool checks that called the decision model fell from about 29,000 on 15 October to 11 on 19 October.

## Simulated sessions (September 2026)

On Sep 27–28 2026, 9 tasks (3 web pages, 6 engineering) ran bare and with Jevis, in both Codex (GPT-6 Sol) and Claude Code (Opus 5.5). A simulated user wrote follow-ups, a blind judge compared each pair, and hidden checks tested the result.

- **Where Jevis acted, it mostly won:** 20 wins, 6 losses, 1 tie across 27 pairs. Design pages went 10–2, engineering 10–4. Jevis caused no new hidden-check failures.
- **The judge is noisy:** in the 9 pairs where Jevis did nothing, it still picked one side 5–1.
- **It takes longer:** a median 1.56× the bare time, 2.2–2.6× on design. Almost none of that is Jevis (hook calls took about half a second each); it's the agent checking its work and fixing what the review sent back. `--critic off` removes most of it.
- **It narrows the gap between models, without closing it:** bare Codex lost to bare Claude Code 1–5; Codex with Jevis beat bare Claude Code 4–2.

The simulation is small: one seed of most tasks and a model as the judge. There are no SWE-bench or Terminal-Bench numbers. To rerun the simulations: `node eval/sim.mjs`, then `node eval/sim-report.mjs <summary.json>`. [`docs/flow.html`](flow.html) walks through each hook.

Across the maintainer's use, Jevis v1 made the biggest difference to GPT-6 Sol and GPT-6 Luna. For which model to use, see [Coding models](models.md).
