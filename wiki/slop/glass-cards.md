---
event: tool
tools: [Write, Edit, MultiEdit, apply_patch, Bash]
when: { marks.plain_read: false }
ask: Does `input` write user-interface code that makes cards, panels, or navigation from frosted glass: backdrop-filter blur on a translucent white or tinted background, often with a thin light border?
yes: backdrop-filter: blur(...) or Tailwind backdrop-blur with bg-white/10, rgba(255,255,255,0.1), or similar translucent fills on cards, panels, or nav bars
no: A single sticky header blur over scrolling content with an opaque-enough fill, a modal scrim, or no blur. The pattern is only named in prose, comments, documentation, a lint rule, a test, or a list of things to avoid; the command only reads or searches files; or the file is not part of a user interface.
unless: Does `request` explicitly ask for glass, frosted, or glassmorphism styling?
min: 0.85
action: deny
title: Frosted-glass cards
source: 'a private style guide (ask what a gradient, border, shadow, or effect contributes). User, 2026-09-27: "block some of these bad design mistakes that Codex and sometimes even Claude make. They are just blatant telltale signs of the product being AI design, AI slop."'
---
Frosted-glass panels over a colored blur are generated-UI shorthand for 'modern'. They lower text contrast, cost paint time, and make every surface look the same.

Instead: use opaque surfaces with a clear elevation system (ground, raised, overlay), separated by tone or a hairline rule. Reserve blur for one functional case, such as a sticky header over scrolling content, and check contrast there.
