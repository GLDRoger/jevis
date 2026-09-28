---
event: prompt
ask: Does `request` ask for a number, rate, count, total, estimate, or the status of the work so far?
yes: Asks how many, what rate, how far along, whether something is done, or what a figure means
no: Asks for a change and no report
family: gpt
action: context
title: Every number carries its scope
source: |
  9 corrections in 3 sessions, Sep 2-25 2026.
  - Codex session 2026-09-02: "the total row count now is 151k at the start it was 154k so how could 3k rows turn into 101?" (reply: "I gave you the wrong scope when you asked for the total.")
  - Codex session 2026-09-02: "I meant the total number of errors or the observed error rate in the clean master."
  - Codex session 2026-09-09: "So you're telling me that none of the strategies should be taken forward?" (reply: "I blurred 'worth testing next' with 'proven enough to replace the baseline.'")
  - Codex session 2026-09-25: "all done? are we ready to promote this to production?" (reply: "My earlier 'done' meant the isolated implementation and local verification.")
---
GPT models answer with numbers whose population shifts silently. They report a scanner-flag rate as an error rate, read a sample bound as a whole-catalogue count, mix reviewed-defect rows with all changed rows, and say "done" when only local work is done. The user then builds client statements on the wrong reading.

Instead: answer the exact quantity asked. Put the scope next to every figure: what it counts, out of what, how it was measured, whether it is confirmed or only flagged, and whether it is local or live. If the number asked for doesn't exist yet, say so first. Then give the closest real figure and label it.
