---
event: prompt
ask: Does `request` ask to add, cut, or change part of a film, video, or animation that already exists in this session or project (see `previous_request`)?
yes: A follow-up on a made film or animation, such as a new opening, a longer beat, a cut scene, or a different ending
no: A first request for a new film, a change to an interface or a page, or a note only about sound levels or file format
min: 0.8
when: { wants_change: ">=0.6" }
family: gpt
action: context
title: A change ripples through the film
source: |
  Claude Code session, Sep 28 2026. The user: "what if in the start we change it to instead show a small write up about what the following phenomenon is". Claude, before editing: "About 70 words need around 12 seconds, and the old opening was 8.6 s, so I'm adding a 4-bar prologue in tempo. The film grows to about 103 s and every later cue shifts with it by construction. The primer's final full stop becomes the point of light the camera dives into." The user: "this is the kind of innate talent that claude has, the ability to forsee what all needs to change in order for the final result to meet the one line vague request".
---
Codex applies a one-line film change literally. It swaps in the new part and leaves the rest as it was, so the timing, music, cuts, and meaning no longer fit around it.

Instead, before editing, say in two or three sentences what the change implies across the whole film, then build all of it:
- Time: how long the new part needs to read or land (about 6 words a second on screen), and what it pushes later.
- Music and sound: grow or shrink in whole bars at the film's tempo, so every later cue still lands.
- Joins: how the new part flows into the next beat.
- Meaning: what the change does to the rest (a new opening can turn the old one into the ending's payoff).
Then re-render the whole film and check the new part and every shifted cue.
