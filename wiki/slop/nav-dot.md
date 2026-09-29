---
event: tool
tools: [Write, Edit, MultiEdit, apply_patch, Bash]
when: { marks.plain_read: false }
ask: Does `input` mark the active navigation item with a small dot placed under or beside the link?
yes: A dot or small circle positioned below the current nav link (for example an ::after with border-radius 50% under an aria-current link)
no: A weight or color change on the current link, a real sliding tab indicator, or a status dot that shows live data. The pattern is only named in prose, comments, documentation, a lint rule, a test, or a list of things to avoid; the command only reads or searches files; or the file is not part of a user interface.
unless: Does `request` explicitly ask for a dot under the active item?
min: 0.85
action: deny
title: The dot under the active nav item
source: 'a private design law: "The dot under the active nav item".'
---
A lone dot under the current nav item is decoration standing in for a real active state.

Instead: show the current page with the type itself: a weight or color shift on the active link.
