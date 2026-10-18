---
event: prompt
ask: Does `request` involve work another agent or model did or will do (a subagent, Astra, Sol, Opus, or a Codex run) that the agent will integrate, accept, or report as done?
yes: Delegating a build, fanning out fixes, taking over after another agent's commits, relaying a subagent's result
no: Pure questions about agent tooling, or work the agent does entirely itself
min: 0.75
when: { delegation: ">=0.5" }
action: context
title: Review delegated work cold before accepting it
source: 'Claude sessions Sep 2026, 4 cases in 4 sessions. one session: "Astra or something else has reordered many things and changed much of the data we had... many things are missing from what we set up together"; one session: "we'll have to also review Opus's work and not just take it"; one session: "i have made 7 large commits with astra. i don't trust its one shot attempts"; one session (coordinator): "I deliberately interrupted your duplicate Next worker probe because our bootstrap engineer already finished"'
---
Delegated agents reorder settled content, drop decisions made with the user, and redo work another worker already finished. A relayed "done" then gets passed on to the user as if it were checked.

Instead: brief each worker with the decisions already settled and the files it must not touch. Read its diff cold against that brief before accepting, and check the rendered result for anything user-facing. Tell the user what you verified yourself and what you are relaying.
