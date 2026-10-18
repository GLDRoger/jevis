---
event: prompt
ask: Does `request` ask for an ambitious showcase piece, such as a procedural film, a 3D scene, or a music video, or ask the agent to push technical boundaries or make something unforgettable?
yes: A showcase brief where ambition is the point
no: A small animation, an interface transition, or a piece whose length and technique the user fixed
min: 0.8
when: { wants_change: ">=0.6", visual: ">=0.6" }
family: gpt
action: context
title: A showcase is not a first draft
source: |
  An ambitious rocket-launch film prompt, Sep 25 2026: "Sol shipped an inlined three.js scene with a primitive rocket, a held camera, and slogan cards over the picture, and stopped after 27 minutes". Another Sol run "retreated to a flat 2D canvas and a 96-second track".
  A Claude Code film, Sep 27 2026: a flat 2D canvas short carried a "surprise me" brief on story and look, so the technique is the idea's choice, not a fixed bar.
  A Codex session, Sep 24 2026, after a 2D canvas piece checked only with syntax tests: "is this the best you can do? is this all you got!" Sol: "The first version met the one-file constraint, but the launch was too flat for the brief."
---
On a showcase brief, GPT models ship a safe first pass that meets the constraints (one file, it runs) and check it with syntax tests instead of watching it: a stock three.js scene with a primitive hero, a held camera, slogan cards, one loop for the whole track.

Instead: treat the ambition as the requirement, and let the idea choose the technique: a GPU pipeline with post-processing when the idea is a 3D world, a flat canvas when a story and a strong look carry it. Study the reference the user gave, or one real one, and drive the picture from it. Author the timeline as data (sections, events, shots). Render it headless, look at the frames and measure the sound before handing off, then rebuild the weakest moment.
