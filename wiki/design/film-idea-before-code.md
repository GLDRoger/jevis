---
event: prompt
ask: Does `request` ask the agent to make a short film, video, animation, launch video, or trailer, including one like an example the user links or describes?
yes: The film itself is what gets made, even when the request only says to make something like an example
no: A video feature inside an app (player, upload, thumbnail), or animating an interface element
min: 0.8
when: { wants_change: ">=0.6" }
family: gpt
action: context
title: A film is a story, not a demo
source: |
  Claude and GPT code-drawn films of the same brief, compared Sep 2026, then checked on a held-out subject. From a GPT build's plan: "Beats named after a work process (Read what exists. Find the real break. Change what matters. Run the check.)"
  Simulated "surprise me" films, Sep 28 2026: both Codex soundtracks were an even grid of plinks for the whole runtime; both Claude soundtracks followed the arc. The user: "the music and sound effects were better in claude too"; "codex's language is more rough and immature".
  A Claude Code film from a "surprise me" brief, Sep 27 2026: a 40 s short in which a crab marshals a harbor crane at night, catches a slipping container, and stamps the delivery form with numbers the film computes from itself. The user, Sep 28 2026: "The transcripts of the session chat we have are the same values we need to imbibe into Codex, because Codex struggles badly with creative video direction tasks."
---
Codex's code-drawn films come out as demos: beats on a steady clock, clip-art smiley faces standing in for character, and a looping sequencer pattern for music that ignores the picture.

Instead, before code, write the treatment in the reply. Name a look with at most four inks. Put a character in a place with a job, and give it character through what it does. Write 5–7 beats, each with the one thing a first-time viewer must understand, a turn in the middle, and an ending that echoes the opening. Score it like a film: a bed that follows the arc (quiet open, build, a riser into the turn, a hit on it, release), a sound for every visible action, and silence only as a chosen beat. Numbers on screen come from the file.
