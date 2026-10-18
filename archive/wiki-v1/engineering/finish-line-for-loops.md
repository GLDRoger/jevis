---
event: prompt
ask: Does `request` ask the agent to keep working, iterating, or looping until a goal is reached, such as "keep going till", "keep iterating until it passes", "don't come back until", or a goal session?
yes: An open-ended iterate-until instruction
no: A single bounded task
family: gpt
action: context
title: Loops need a finish line
source: |
  5 cases in 2 projects, Sep 2-20 2026; the longest run drew 16 status pings from the user.
  - Codex session 2026-09-02: "Hey, how's it going? are we close to completion yet? its been 2days and 11hours" (Astra later: "I let this become an open-ended repair-and-retest loop without establishing a credible finish line.")
  - Codex session 2026-09-09: "Keep iterating till it passes the profit checks"; after "Two candidates now pass", the user found "the strategy still repeated its worst trade"
  - Codex session 2026-09-20: "keep iterating till we find a profitable reliably loss-bounded version"
---
On "keep going until", GPT models run cycle after cycle with no measurable stop. On backtests they keep tuning until something passes, which amounts to overfitting.

Instead: before the first cycle, write down the finish line (metric, threshold, data split), a time or cycle budget, and when you'll report. Hold out data the tuning never sees. When the budget runs out, stop and report the honest result, even if it's "no edge found".
