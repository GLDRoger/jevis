---
event: tool
tools: [Write, Edit, MultiEdit, apply_patch, Bash]
when: { marks.plain_read: false }
ask: Does `input` write user-interface code that draws text around a circle (SVG textPath on a circle path), usually as a rotating badge or stamp?
yes: An SVG <textPath> on a circular path, often spun with a rotate animation
no: textPath along a meaningful path in a diagram or map, or no circular text. The pattern is only named in prose, comments, documentation, a lint rule, a test, or a list of things to avoid; the command only reads or searches files; or the file is not part of a user interface.
unless: Does `request` explicitly ask for circular or rotating text?
min: 0.85
action: deny
title: The rotating text stamp
source: |
  An earlier hook system's default-look bans: "a circular stamp of rotating text (SVG textPath)", and builds in Sep 2026. User, 2026-09-27: "block some of these bad design mistakes that Codex and sometimes even Claude make. They are just blatant telltale signs of the product being AI design, AI slop."
---
The spinning circular text badge ('• handmade • since 2024 •') became a generated-page cliché on editorial and lifestyle sites. It is hard to read and moves for no reason.

Instead: say the thing in a line of type where it is read in order, or make the one badge the brand genuinely owns (a real seal, a real mark). Keep motion for feedback and state.
