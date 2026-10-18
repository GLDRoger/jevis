---
event: stop
ask: Does `final_message` admit that part of the requested work was not run, tested, or exercised, without naming a concrete reason it cannot be done here?
yes: For example "I did not test the upload" or "not verified end to end", with no blocker given
no: It names a concrete blocker (production credentials, hardware, a paid account), or the untested part was not requested
min: 0.9
when: { work_requested: ">=0.6" }
action: block
title: Disclosing a gap instead of closing it
source: |
  An earlier hook system's engineering gate, Sep 25 2026: a session ended "I did not complete a browser end-to-end photo upload" and the old gate would have passed it. Count: 2 (that session, and 1 logged block where the admission did carry a reason and the block was wrong).
---
The agent names the gap in its final message and stops, as if disclosing it finished the work.

Instead: do the untested part now: run the flow end to end and confirm the result. If it truly cannot run here, state the specific blocker.
