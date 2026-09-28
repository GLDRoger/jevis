---
event: tool
tools: [Write, Edit, MultiEdit, apply_patch, Bash]
ask: Does `input` write user-interface styles that give cards, callouts, list items, or quotes a single thick colored accent bar along one edge (left, right, top, or bottom), as a colored border on that side or an inset shadow?
yes: border-left or border-top 3px or more in an accent color, Tailwind border-l-4 or border-t-4 with a color, or box-shadow: inset 4px 0 0 <color> on cards, notes, alerts, stat boxes, or selected items
no: A thin neutral divider, a table or grid border, a code-diff gutter, or a focus ring. The pattern is only named in prose, comments, documentation, a lint rule, a test, or a list of things to avoid; the command only reads or searches files; or the file is not part of a user interface.
unless: Does `request` explicitly ask for a colored left border or side bar?
min: 0.85
action: deny
title: Colored accent-edge bars
source: 'a private design law: "The accent-bar card". User, 2026-09-27, with screenshots: "boxes getting these colored left edges are slop too" (a scenario card with a yellow left bar on the Jevis data-flow page).'
---
A colored bar down the left edge of a card or callout is the generated-UI way to say 'this one is special'. It appears on every alert, quote, and selected item, so it stops meaning anything and makes the page look assembled from a kit.

Instead: mark state with the whole object: a change of fill or tone, a weight change in the title, a check or label that names the state, or position in the list. For callouts, a small label ('Note', 'Warning') with an icon from the project's set says more than a stripe.
