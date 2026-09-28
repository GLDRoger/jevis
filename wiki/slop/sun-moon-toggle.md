---
event: tool
tools: [Write, Edit, MultiEdit, apply_patch, Bash]
ask: Does `input` write a theme switch built as a sliding pill or knob with sun and moon icons?
yes: A toggle track that slides a knob between a sun and a moon, or a button swapping sun and moon icons for light and dark mode
no: A theme control designed for this product in another form, a plain text control, or no theme switch. The pattern is only named in prose, comments, documentation, a lint rule, a test, or a list of things to avoid; the command only reads or searches files; or the file is not part of a user interface.
unless: Does `request` explicitly ask for a sun and moon toggle?
min: 0.85
action: deny
title: The sun-and-moon theme toggle
source: 'a private design law: "The sun-and-moon theme toggle, and redrawn line icons".'
---
The pill that slides between a sun and a moon is the stock theme switch and reads as generated the instant it appears.

Instead: design the control for this product: a labeled segmented choice (Light, Dark, System), a word that changes, or a mark from the brand's own language.
