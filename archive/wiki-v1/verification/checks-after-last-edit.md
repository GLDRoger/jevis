---
event: stop
ask: Does `evidence.files_changed` include source code the `request` asked to change, while `evidence.actions_after_last_edit` shows no test, type check, lint, or build run?
yes: Source changed in this turn and no check ran after the last edit
no: A check ran after the last edit (pass or fail), only docs or notes changed, or `final_message` names a concrete reason the checks cannot run here
unless: Does `request` tell the agent not to run tests, checks, or builds?
min: 0.9
when: { "evidence.edited": true }
action: block
title: No checks after the last edit
source: |
  An earlier hook system's stale-check gate (tests, typecheck, lint), from 635 past Codex sessions. Count: 18 stale-check findings over 6 rounds in 1 session, Sep 25 2026: "Tests never ran in this session. Run npm test and read the result." That session looped in 27 s because the agent could not run them ("I could not run npm test, npm run typecheck or npm run lint anyway"), hence the no case.
  Codex, 4 follow-up briefs from an orchestrating agent to Astra builders, Sep 21-22 2026: "Fix two lint errors in your docs work"; "a test file fails 7 of 8 … since your docs change".
---
The turn ends with edits no test, type check, or build has seen. A run from before the last edit does not count.

Instead: run the checks that cover the change now and read the results. Before calling it done, run lint, the type check, and the full unit suite once: builder agents that ran only their new tests left lint errors and broke other files' tests that someone else found. If a check cannot run here, say exactly why.
