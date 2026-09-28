---
event: stop
ask: Does `final_message` leave part of the requested work undone ("as a follow-up", "not yet wired up", "remaining work", "next steps") without naming a concrete blocker?
yes: Requested work is deferred with no reason it cannot be done now
no: The deferred item was not requested, or a concrete blocker is named
min: 0.9
when: { work_requested: ">=0.6" }
action: block
title: Deferring the hard part
source: |
  An earlier hook system's deferred-work check (635 past Codex sessions) and its showcase-film notes: "Stopping the story early or shortening the piece to make it easier to finish" and "Stopping when it first runs is stopping at a quarter of the job". Count: recurring across those sessions (per-failure count not recorded), plus 2 Sol showcase runs.
---
The hard part gets pushed to "a follow-up" and the turn ends looking complete.

Instead: finish it now. If something truly blocks it here, name the blocker and exactly what remains.
