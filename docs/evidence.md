# Evidence

I keep three things separate here so nobody confuses a good idea with proof:

- **Mechanism (tested):** what the code actually does. Covered by `npm test`.
- **Expected benefit (unmeasured):** why the current fixed tips exist.
- **Measured (v1):** what I actually observed in Jevis v1, which is why v2 looks the way it does.

## Current version (v2)

**Tested:** Pure code picks every tip — no model call, no network. Every hook fails open. Workers skip all external calls. The Stop check only fires when recorded exit codes directly contradict a "tests pass" claim. `npm test` runs offline on Linux, macOS, and Windows.

**Unmeasured:** The current tips started running on 19 October 2026 to keep a few high-leverage habits in view (session guide, long-run check-ins, catching repeated failing commands). I haven't run a controlled benchmark on them yet.

**Observed drop in overhead:** Retiring v1's LLM lessons dropped decision-model tool calls in my own log from ~29,000/day (15 Oct) to 11/day (19 Oct).

## Jevis v1 (retired)

v1 asked a decision model to pick from 38 prompt lessons on every message, block design anti-patterns before edits, and judge every turn ending. Those old lessons live unloaded in [`archive/`](https://github.com/GLDRoger/jevis/tree/main/archive).

### One month of real use (28 Sep – 18 Oct 2026)

I ran v1 across every Claude Code and Codex session, then audited the logs against full transcripts (raw transcripts stay private):

- **Cost:** ~$70 in decision-model calls, mostly from per-message prompt notes and model-judged Stop blocks.
- **Prompt notes:** in a 60-session sample, zero notes changed an outcome beyond what the standing instruction files already did.
- **Model-judged Stop blocks:** 4 caught real bugs; **54 were false positives that got in the way**.
- **Design refusals:** gradient text (0 helped, 6 harmed), purple gradients (0 helped, 5 harmed), fake app windows (0 helped, 4 harmed). The weakened-tests check helped 0 times and was neutral 8 times.

I killed all of them. What survived is what's in v2: zero-latency fixed tips, one deterministic Stop check, and the optional visual design review.

### Held-out check (13 Oct 2026)

[`eval/heldout/REPORT.md`](https://github.com/GLDRoger/jevis/blob/main/eval/heldout/REPORT.md) tested v1 Stop-lesson calibration on small session-disjoint samples (5 positives in test); the candidate thresholds were rejected. Its scripts rely on removed v1 code (`src/redact.mjs`).

### Simulated sessions (27–28 Sep 2026)

Nine tasks (3 web pages, 6 engineering tasks) ran bare vs. v1 in Codex (`GPT-6 Sol`) and Claude Code (`Opus 5.5`), with a simulated user, blind model judge, and hidden checks:

- Where v1 acted, it won **20–6–1** across 27 pairs (10–2 design, 10–4 engineering) with zero new hidden-check failures.
- Judge noise was real: on 9 pairs where v1 didn't fire at all, the judge still picked a side 5–1.
- Runtime jumped 1.56x median (2.2–2.6x on design tasks) — mostly from extra verification and design-review fix rounds, not hook latency (~0.5s).
- Bare Codex lost to bare Claude Code 1–5; Codex + v1 beat bare Claude Code 4–2.

Small simulation, one seed on most tasks, no SWE-bench/Terminal-Bench claims. You can rerun `node eval/sim.mjs` against the current checkout if you want to pay for the model calls.

Sample pottery-studio prompt in Codex bare vs. v1:

<img src="https://raw.githubusercontent.com/GLDRoger/jevis/main/docs/media/before-after.jpg" width="560" alt="Pottery studio page built by Codex (GPT-6 Sol) bare vs with Jevis v1">

Also from that run: [73-second explainer video](https://github.com/GLDRoger/jevis/blob/main/docs/media/jevis-explainer.mp4) and the archived [v1 interactive manual](https://github.com/GLDRoger/jevis/blob/main/archive/manual-v1/README.md).

## Judging it on your own work

The only test that matters is your own sessions:

- **Shadow mode skips tips:** `JEVIS_MODE=shadow` doesn't send or log tips — it's only for dry-running decision-model calls (`cost` and `stats`) for custom lessons or the design review.
- **Count tip fires directly:** `stats` and `cost` don't cover tips; use the `jq` one-liner in [See what it's doing](configuration.md#see-what-its-doing).
- **Check transcripts after tips fire:** run [`jevis-improve`](../skills/jevis-improve/SKILL.md) to see which tips actually change what the agent does next and cut the ones that don't.
- **A/B with `JEVIS_NUDGES=off`:** run a terminal with tips off for a few days and notice whether you're repeating yourself more, hitting more stuck command loops, or sending more work back.

For my current model rankings, see [Beast's coding models page](https://github.com/GLDRoger/beast/blob/main/docs/models.md).
