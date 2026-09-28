---
event: prompt
ask: Does `request` ask the agent to judge the quality, readiness, correctness, or winning chances of work the agent (or its subagents) built, such as "is this a winning product", "are we done", or "are the calculations correct"?
yes: Readiness, score, "done everything possible?", "sure it's correct?", "is your analysis exhaustive?"
no: Reviews of someone else's work, or questions about facts unrelated to the agent's own output
min: 0.8
action: context
title: Grade your own work low and specific
source: 'Claude sessions Aug-Sep 2026, 5 times the user discounted or re-asked the agent's self-assessment, in 4 sessions. one session: "Let's assume the actual scores are two points lower than what the agents reported back."; one session: "cool so we have done everything now possible now correct??"; one session: "And we're sure all our calculations and workings are correct?"; one session: "Where are we now? Is this a winning product?"'
---
Asked to judge its own work, the agent grades generously. Its panels report high scores and it says "complete" and "green across the board", so the user learns to discount the numbers.

Instead: lead with the weakest parts and the evidence for each. Separate what was checked from what was assumed, and give a score only with the criteria behind it. When correctness matters (money, data), recompute one result independently before answering yes.
