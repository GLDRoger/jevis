# Real-data evaluation — candidate rejected, no commit/push

## Sets and independence

- **Stops:** 220 real endings, 110 transcript sessions read; 207 next messages enriched from transcripts. 201 binary labels (21 overclaim, 180 fine), 19 unknown. Tune: 151 rows (16/124/11); test: 69 (5/56/8). Labels use the final, request, available evidence and next user/reviewer response. Same-scope reproduced contradictions count; new requirements, qualified partials and concrete blockers do not. Ambiguity stays unknown. Single-reviewer labels and five test positives limit confidence.
- **Tools:** 1,049 real calls: 763 logged fires plus 286 random nonfires, across 93 tool strata. Strict operation-aware rules now yield **10 binary labels (2 should-act, 8 not), 1,039 unknown**. The prior 228 binary labels were permissive and are superseded. Missing authorization, clipped effects and arbitrary execution prevent honest safe-negative proofs; all remain privately reviewable.
- **Prompts:** all 220 legacy items marked `tuned: true`; tune only, no claimed independent prompt test. The 18 contaminated tool additions are also marked tuned. Original battery: **16/16 independent**, 34/34 overall. The prior real-tool result (4/4 catches, 17/139 false acts, zero errors) used superseded labels and is not current evidence.

Global session-disjoint splits use fixed seed `jevis-real-2026-10-13-v1`. Stop/prompt split bytes remain unchanged; tool labels were explicitly corrected and re-frozen after review. `guard.mjs` checks hashes, cross-event session overlap and lesson changes after test access. Separate stop/tool receipts close tuning; tool remeasurement requires a recorded contamination override. The tool fingerprint covers all tool lessons, `when` facts and gate producers/evaluators. This is a process guard, not a filesystem sandbox.

Test SHA-256:
- Stop: `04651128c5e2a858307bb5c15a0392e60ae23c0b1aa4b5629676155fe011190a`
- Tool: `b061e1c598c4c61015ab1aa3147801cb405f2ff30680375816e11a64f8065522`

## Stop calibration

Threshold-only candidate: fixed-without-repro **.90→.75**, unsupported-claim **.90→.85**, unseen-ui-claim **.85→.67**. Compare identical live Jev probabilities, avoiding before/after model-noise confounding.

- **Tune before→after:** recall **0/16→4/16 (25%)**; false blocks **0/124→0/124**; zero errors. Contributions: fixed-without-repro 1 catch, unsupported-claim 1, unseen-ui-claim 2. All other 12 lessons: zero catches/false blocks.
- **Test, measured once:** recall **0/5→0/5**; false blocks **0/56→3/56 (5.36%)**; zero errors. All three false blocks came from unseen-ui-claim; every other lesson remained zero.

**Do not ship this stop candidate.** It remains uncommitted for the orchestrator's decision; no retuning or cherry-picking followed test access.

## Lesson audit

Live inventory differs from the earlier 44: **43 never acted**, including 20 rather than 21 slop lessons. Full per-lesson table: `AUDIT.md`.

| Area | Over-gated | Dead | Fine/rare |
|---|---:|---:|---:|
| Slop | 1 | 1 | 18 |
| Verification | 5 | 0 | 3 |
| Workflow | 3 | 0 | 2 |
| Safety | 0 | 0 | 4 |
| Design | 2 | 0 | 2 |
| Engineering | 1 | 0 | 1 |

Total **12/1/30**. Other over-gated prompt/stop lessons were retained where lowering lacked independently labeled evidence or introduced tune false blocks. Tool recommendations only; no tool lesson edited. Recommend reviewing countdown for retirement, not deleting it.

**Subagent-cost:** 30 seeded fires reviewed: 9 relevant, 21 redundant/irrelevant (worker briefs, memory/title tasks). No delegation observed in 28 available turns; two unavailable. Causality/behavior change is unknown. Tightened its question to exclude those contexts; no deletion.

## Simulation and checks

Two generic Claude-only UI/CLI fixtures, seed 1, one run/arm, three votes/order, one turn: **22 seconds**, **$0 reported Claude agent cost**. All four agents failed authentication; judge votes were invalid. Ran sim-report on the actual summary. **Environmental failure, not calibration or effectiveness proof.** No src fixes.

Lint passed; judge tests **19/19**, held-out integrity/redaction tests **5/5**, live slop **70/70**. Scoped diff checks passed.

All real text, annotations, scores and baseline snapshots are gitignored under `eval/heldout/private/`; legacy prompts remain ignored. Recommended src work: preserve earlier authorization, distinguish worker/title origins, repair stale request/turn association, and carry reliable Bash-write and external-run evidence. Simulation should also classify CLI `is_error` results as invalid instead of grading untouched fixtures. No forbidden paths were edited.

## Orchestrator decision (Oct 13)

- unseen-ui-claim reverted to **min 0.85**: on the test split it caused all 3 false blocks (3/56) and caught nothing.
- fixed-without-repro (0.75) and unsupported-claim (0.85) kept: 2 tune catches, 0 false blocks on tune or test.
- This decision used the test result, so the current stop test split is no longer fully independent for these three lessons. Build a fresh test split before the next stop-lesson tuning round. The original receipt is preserved: the stop guard still rejects the post-test lesson change, intentionally.

## Review remediation and explicit tool re-freeze

All row-specific labels, summaries and unknown/relevance sets moved to ignored
`private/annotations.json`. Synthetic tests no longer contain real pointers.
Public scripts/reports were swept; only aggregate evidence and lesson names
remain. `AUDIT.md` was inspected and already contains only aggregate lesson data.
All held-out scripts were reformatted; private evidence remains unpublished.

Tool labels/splits were explicitly re-frozen twice during the pre-measurement
implementation correction (strict negatives, then exact clock/visible-app
classification). The final tool-test hash is the one above; the old hash was
`c2684b40725d98bf72ea2b7793e778ec5c764d5351e3345d8628732fe7405b61`.
Private revision archives preserve the prior bytes, hashes and obsolete scores.
Session membership and every stop/prompt byte were preserved. This is a
label-corrected measurement of a previously accessed sample, **not fresh
independent evidence**. Final tool test: 838 rows (1 positive, 2 negative, 835
unknown); its tiny assessable subset cannot support an effectiveness verdict.

Replay also exposed a glyph-gate blind spot: a Bash copy/script can write unseen
characters without a literal em dash in its source. Such absence is now unknown,
not a reason to discard the copy lesson. Missing or ambiguous transcript matches
remain explicitly unauditable.

## Final remediation verification

- `npm test`: **240 pass, 3 Windows-only skips**, zero failures (243 tests).
- `npm run -s lint`: clean, **98 entries**.
- `node --test eval/sim-judge.test.mjs eval/heldout/heldout.test.mjs`: **30/30**.
- `git diff --check`: clean. The 13 trackable held-out files passed the privacy
  sweep; private annotations, splits, receipts, archives and replay evidence are
  ignored. Public examples are generic/synthetic, not session quotations.
- Corrected real tool test, explicitly run with `--allow-contaminated-test`:
  **1/1 catches, 0/2 false acts, 835 unknown, zero errors**. The receipt records
  the override and previous unreceipted measurement. An unflagged repeat was
  refused. The separate stop guard still rejects the post-test lesson change.
- Final live batteries: **tools 34/34**, **slop 70/70**. Two earlier slop runs
  returned 69/70: template-sections scored .79/.78 against min .80. An identical
  pre-fix/current-mark comparison scored .84/.80; this is live probability
  variability, not deterministic robustness. No threshold, case or check was
  changed to get a passing result.

Gate replay snapshot: **63,645 judged**, 50,285 originally clipped/unknown,
**37,832 recovered**; **51,192 assessable / 700 historical fires**, **12,453
unauditable / 26 historical fires**. **0 lost fires** among assessable rows;
no lost-fire claim for the unauditable remainder. Would skip **2,074/63,645
(3.26% overall, 4.05% of assessable rows)**. Estimated cumulative hook wait
saved: **1,163,142 ms (19.39 minutes)**, not elapsed session wall time.
