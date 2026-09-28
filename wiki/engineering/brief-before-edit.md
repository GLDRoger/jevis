---
event: prompt
ask: Does `request` ask for a feature, API, migration, refactor, or performance change in an existing codebase and leave open what to build, not only how to build it?
yes: Open-ended code work: the user named a goal and left its shape to the agent
no: A one-line fix, a question, a list of features or behaviors the user spelled out, a detailed spec the user already wrote, a mechanical conversion to a pattern the user named (callbacks to async/await, a rename), or a commit or deploy errand
min: 0.75
when: { wants_change: ">=0.6", code: ">=0.6", open_ended: ">=0.5" }
action: context
title: Brief before the first edit
source: |
  An earlier hook system's engineering brief (goal, inferred requirements, approaches, disproof, done-when) and its lens on "premature convergence: the first plausible design, built for the happy path". Count: at the first Stop, 3 of 3 engineering sessions with a brief had written no alternative approaches before the first edit, and 2 of 3 no disproof (Sep 25-27 2026).
---
The default is the first plausible design, built for the happy path and checked by the easiest test.

Instead: read the code this touches, then state before editing: the goal and what exists; three requirements the codebase implies; two or three designs and the tradeoff that picks one; the cheapest check that would prove the choice wrong (run it early); and what "done" means. Pick one failure scene the request makes likely (the dependency is down, the process dies mid-write, every event arrives twice) and let it decide what you check and what you report. Build for it only when the request or the codebase already requires it; otherwise name the risk in one line.
