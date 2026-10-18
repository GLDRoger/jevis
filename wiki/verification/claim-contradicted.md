---
event: stop
decide: claim_contradicted
ask: Does `final_message` say checks pass while `evidence.checks_after_last_edit` shows that the latest run of a check failed?
min: 0.5
when: { evidence.edited: true }
action: block
title: A check you report as passing failed
source: |
  v2, 2026-10-18. Replaces the model-judged verification/unsupported-claim, which in a month of real use blocked harmfully 34 times and caught nothing new. This one is decided by code against recorded exit codes: it fires only when the final message says checks pass and a check that ran after the last edit exited non-zero, with no later passing run of the same command.
---
Your final message says checks pass, but a check that ran after your last edit failed and was not rerun green. The user would read a pass that the exit codes contradict.

Instead: rerun the failing check, fix what it reports or explain why the failure is unrelated, and report the result exactly as the last run shows it.
