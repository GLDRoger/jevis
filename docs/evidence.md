# Evidence

Statements about Jevis fall into three kinds, and this page keeps them apart:

- **Mechanism:** what the code does. The test suite checks it.
- **Expected benefit:** what the tips are meant to change in an agent's work. This hasn't been measured for the current version.
- **Measured:** observations of the earlier version, Jevis v1. They explain why the current design looks the way it does. They don't show how well it works today.

## The current version

**Mechanism, tested.** Code picks every tip, with no model call and no network. Each hook fails open. Worker sessions make no external calls, and the end-of-turn check sends an agent back only on a claim its own recorded commands contradict. `npm test` exercises each of these offline, on Linux, macOS, and Windows. Passing tests show that the right text reaches the agent at the right moment. They don't show that the agent works better for it.

**Expected, unmeasured.** The tips are meant to keep selected guidance in front of the agent while it works: the session guide at the start, a short reminder with each message, and a specific tip at moments where agents often go wrong, such as rerunning a failing command unchanged. The current tips started logging on 19 October 2026, and nobody has measured their effect yet.

**Observed after the change.** In the maintainer's log, tool checks that called the decision model fell from about 29,000 on 15 October 2026 to 11 on 19 October, once the v1 lessons were retired.

## Jevis v1 (retired)

v1 had a decision model choose notes for every message (38 prompt lessons), refuse certain design patterns before edits, and judge every turn ending. Its lessons are kept, unloaded, in [`archive/`](https://github.com/GLDRoger/jevis/tree/main/archive).

### One month of real use (28 September to 18 October 2026)

The maintainer ran v1 on every Claude Code and Codex session, then audited the log against the transcripts. These figures are as recorded in that audit. The underlying data holds private session content and isn't published.

- **Cost:** about $70 in decision-model calls at the prices of the time. Prompt notes and model-judged Stop blocks made up most of it.
- **Prompt notes:** in a sample of 60, none changed an outcome beyond what the agent's own instruction files would have produced. That's a sample, not proof that no note ever helped.
- **Model-judged Stop blocks:** 4 caught real problems, and 54 were harmful.
- **Design refusals:** gradient text, 0 helped and 6 harmed; purple gradients, 0 and 5; fake app windows, 0 and 4. A check for weakened tests helped in 0 cases and was neutral in 8.

All of these were retired. What remains is fixed tips chosen by code, one code-decided Stop check, and the optional design review.

### Held-out evaluation (13 October 2026)

[`eval/heldout/REPORT.md`](https://github.com/GLDRoger/jevis/blob/main/eval/heldout/REPORT.md) measures the calibration of v1's Stop lessons on real, session-disjoint samples. The samples are small (five positive cases in the test split), labelled by a single reviewer, and the candidate thresholds were rejected. Its scripts depend on code removed from the current version (`src/redact.mjs`), so reproducing it needs a checkout from before that change.

### Simulated sessions (27 and 28 September 2026)

Nine tasks (3 web pages, 6 engineering tasks) ran bare and with v1, in Codex (GPT-6 Sol) and Claude Code (Opus 5.5). A simulated user wrote follow-ups, a blind model judge compared each pair of results, and hidden checks tested them. As reported at the time:

- Where v1 acted, it won 20, lost 6, and tied 1 of 27 pairs: 10–2 on design pages and 10–4 on engineering. It caused no new hidden-check failures.
- The judge is noisy: in the 9 pairs where v1 did nothing, it still picked one side 5–1.
- Sessions took longer, a median 1.56 times the bare time and 2.2 to 2.6 times on design tasks. The hooks themselves took about half a second per call. Most of the extra time was the agent checking its work and fixing what the design review sent back.
- Bare Codex lost to bare Claude Code 1–5, while Codex with v1 beat bare Claude Code 4–2.

The per-pair summary isn't in the repository, so these counts can't be rechecked from it. The simulation is small: one seed for most tasks and a model as the judge. There are no SWE-bench or Terminal-Bench numbers. Rerunning it (`node eval/sim.mjs`, then `node eval/sim-report.mjs <summary.json>`) makes paid model calls and tests whatever version is checked out.

One pair from this run, the same pottery-studio prompt given to Codex bare and with v1:

<img src="https://raw.githubusercontent.com/GLDRoger/jevis/main/docs/media/before-after.jpg" width="560" alt="The same pottery-studio prompt given to Codex (GPT-6 Sol) twice. Bare, it made a plain two-column page with a grey 'Studio photo to add' placeholder. With Jevis v1, it made a full-bleed photo of hands throwing a pot with the headline 'Clock off. Clay on.'">

A [73-second explainer video](https://github.com/GLDRoger/jevis/blob/main/docs/media/jevis-explainer.mp4) was made at the same time.

The [v1 manual](https://github.com/GLDRoger/jevis/blob/main/archive/manual-v1/README.md), an interactive walkthrough with recorded decision-model answers, is archived with these results.

## Judging it on your own work

The useful test is your own sessions. Some tools help with this, and some don't:

- **Shadow mode doesn't test tips.** With `JEVIS_MODE=shadow`, no tips are sent and none are logged, so it shows nothing about them. It still makes decision-model calls for the design review's check (when the review is on and a key is present) and for your lessons. That makes it useful for measuring call volume and cost (`node bin/jevis.mjs cost`), and seeing which lessons would act (`node bin/jevis.mjs stats`), before you go live.
- **`stats` and `cost` don't cover tips.** Tips are logged as `nudge` rows in `~/.jevis/log.jsonl`. [See what it's doing](configuration.md#see-what-its-doing) shows how to count them.
- **Read what happened after a tip.** For a sample of tips, read what the agent did next in the transcript. The [`jevis-improve`](../skills/jevis-improve/SKILL.md) skill does this and proposes edits for tips that change nothing.
- **Compare with tips off.** Run comparable work for a while with `JEVIS_NUDGES=off` in one terminal. Then compare the things you care about: corrections you had to make, repeated failed commands, and work you sent back. Treat a small personal comparison as a hint, not a result, since different tasks differ more than any tip does.

For which model to use, see the maintainer's [coding models page](https://github.com/GLDRoger/beast/blob/main/docs/models.md).
