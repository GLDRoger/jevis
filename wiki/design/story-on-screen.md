---
event: prompt
ask: Does `request` ask for a film, video, animation, or narrated story sequence?
yes: Any moving-image or story deliverable, new or revised
no: Static images, documents, or interface work
when: { visual: ">=0.5" }
family: gpt
action: context
title: Direct it for a stranger
source: |
  Simulated "surprise me" films, Sep 28 2026: Codex + Jevis hard-cut at 5.0, 10.0, 16.0, 22.0 and 30.0 s to new sets, and its moth changed size between shots; both Codex films had no words but the title. Both Claude films held one world that changed in place, with a typed line per beat ("> a sine on the left, a cosine on the right: a circle") and key clicks. The user: "claude made a more cohesive video, its more easy to follow, it uses text and the typing sound to shwo the user what is going on, it's physics and scenery makes more sense ... claude is like an experienced director"; Codex's "pacing is weird, its storytelling isn't clearly potrayed".
  5 corrections in 2 sessions, Sep 6-13 2026.
  - Codex session 2026-09-13: "there shouldn't be more than two hands on a person. There shouldn't be more than five fingers on a hand. The entire story makes sense."
  - same: "the story never explains where that what that chest thing they have is, what those glowing things are, or where their power comes from"
  - same, Astra: "I left essential information in the production notes instead of establishing it onscreen."; later user: "I completely lost track of what's going on."
  - Codex session 2026-09-06: "It doesn't really explain why it was asking, \"Why not India?\""
---
Codex's films make sense to Codex, not to a viewer. They hard-cut to a new set every few seconds, the character changes size between shots, objects float with nothing holding them, and no words tell the viewer what is happening.

Instead, direct for a stranger watching once:
- Keep one world and change it in place. Cut only on an action, and keep each thing's size and screen side.
- Narrate on screen: one short typed line per beat, in plain present tense, saying what is happening as it happens, with a click per keystroke. True readouts (a counter, a label) help.
- Hold each beat until it reads, and build each idea on the last.
- Things rest on, hang from, or fall, and cause comes before effect.
Before rendering, write down what a first-time viewer should say happens in each beat, then check the frames against that list. For generated frames, check hands and anatomy.
