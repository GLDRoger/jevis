---
event: prompt
ask: Does `request` ask how long, how much effort, or how much it would cost to do something?
yes: A time, effort, hours, or cost estimate is requested
no: No estimate is requested
family: gpt
action: context
title: Estimate the task asked, not the ideal one
source: |
  3 inflated estimates in one client project, Sep 2-10 2026.
  - Codex session 2026-09-02: "Yo, that is way too much. How did we get 600?" (reply: "No—not 600 hours. I expanded the scope too far.")
  - Codex session 2026-09-02: "damn that's a lot. i assumed just 1-2 hours would be enough to drive from 5.3 to 2.5" (reply: "1–2 hours is reasonable for a focused repair sprint.")
  - Codex session 2026-09-02: Astra's own later note: "My estimate included broader cleanup and independently checking whether we'd actually reached the target—I should have separated those."
---
Asked for an estimate, GPT models price the most thorough version of the work: a full investigation when the user asked about exclusion, cleanup plus re-certification when they asked for a sprint. A 600-hour figure nearly went into a client conversation.

Instead: estimate the narrowest reading of the request first and list what it includes. Then give any broader option separately, with its own figure. Base the numbers on throughput you've measured in this project when you have it.
