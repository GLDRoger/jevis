---
event: prompt
ask: Does `request` ask the agent to design or restyle how a work tool looks (a SaaS app, internal tool, admin, or docs site), without asking for a bold or experimental look?
yes: The look of a work product is the subject: its visual design, layout, or styling
no: Feature work, bug fixes, data, or behavior changes where the look is not the subject; bold, playful, or editorial work; art pieces and campaign pages
min: 0.75
when: { wants_change: ">=0.6", visual: ">=0.7" }
action: context
title: Production looks need restraint
source: |
  An earlier hook system's notes, Sep 24 2026: prompts asking for a production look get "production design systems instead of metaphors", with 4 rules from user feedback. Count: polish checks calibrated on 5 production sites; 3 logged prompts scored in this register.
---
Pushed toward distinctiveness, a work tool comes out as an art piece: display type in the chrome, giant watermark words, glass panels, tracked capitals on every label, a metaphor that restyles the controls.

Instead: treat restraint as the craft. Define tokens first (neutral ramp, 4 px spacing, radii, six type sizes at most), keep one accent beyond status colors, use 100–200 ms functional motion, design both themes, and ship every state: hover, selected, focus ring, disabled, skeleton, empty with a next action, inline error.
