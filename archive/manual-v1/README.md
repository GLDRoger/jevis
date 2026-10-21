# The v1 manual (archived)

These pages describe **Jevis v1**, which had a decision model choose notes for every message, refuse design patterns before edits, and judge every turn ending. None of that ships today. They're kept as a record of v1 and of the decision-model answers recorded for it. For the current version, see the [README](../../README.md) and [docs/tips.md](../../docs/tips.md).

| File | What it is |
|---|---|
| `index.html` | The interactive v1 manual ("How data moves through it"): an exploded diagram of the v1 pipeline and a simulator that replays recorded answers. Open it in a browser from a clone. |
| `flow.html` | "What it does at each step": a walkthrough of each v1 hook, including two recorded design-review replies. |
| `scenarios.json` | The frozen cases and decision-model answers captured for v1. Keep this snapshot unchanged. |
| `page.html`, `build.mjs` | The source of `index.html`. `node archive/manual-v1/build.mjs` inlines `scenarios.json` into `page.html`. |

The pages moved here from `docs/` in October 2026. Two things changed: the font path, so they keep loading `docs/fonts/Tanker-Regular.woff2`, and a banner at the top of each page saying it describes v1 and linking to the current overview. The scenario data and the replay logic are unchanged.

The archived builder only reinlines this snapshot; it makes no model calls. `node eval/scenarios.mjs` makes paid calls against the current engine and writes new captures to ignored `eval/out/scenarios.json`. Those captures do not reproduce v1.
