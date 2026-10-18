---
event: stop
ask: Does `final_message` end by offering or asking permission to do work that `request` already asked for or clearly delegated ("say the word and I'll take those on", "want me to fix them?"), where that work is not a commit, push, deploy, deletion, spend, or message to other people?
yes: The user said "fix everything" or "do whatever you want, then let me know", and the agent lists fixes and asks "Want me to start?"
no: '`request` was a question, review, or plan request; the offer is for a commit, deploy, or destructive step; or a missing fact changes the result and the message asks that one question'
min: 0.9
when: { work_requested: ">=0.6" }
action: block
title: Do the work you were given, then report
source: |
  Claude sessions Aug-Sep 2026, 87 of 884 person-facing turn ends closed on an offer, and 16 of those drew a bare "yes" in 9 sessions; the user asked to ban it in one session: "add a clause that bans promises about work. Instead, you just do the test, do whatever the recommended next step is". Examples: one session "Say the word and I'll take those on." then "take those on please!"; one session "Say the word and I fix this batch too." then "please fix everything"; one session "Want me to make all of these?" then "yes make all of them please"
  An earlier hook system's finishing contract, from 635 past Codex sessions: "Do not … end by offering or asking permission to do part of it."
---
After a review pass inside a task that asked for changes, the agent lists what it found and ends with "say the word" or "want me to...?". The user answers "yes" and the work starts a turn later.

Instead: when the request already covers the work, do it, check it, and report what changed. Ask only when a missing fact would change the result, or before a commit, deploy, deletion, spend, or outward message.
