---
event: tool
tools: [Write, Edit, MultiEdit, apply_patch, Bash]
when: { marks.plain_read: false }
ask: Does `input` write user-interface markup that lays out a row or grid of three or more look-alike cards, each with an icon, a short title, and a one-line blurb, to list features, benefits, or values?
yes: A features, benefits, or 'why us' section built as identical icon + title + sentence cards in a 3, 4, or 6 column grid
no: Cards holding real distinct content (products with prices and photos, articles, records in an app), a list, or a table. The pattern is only named in prose, comments, documentation, a lint rule, a test, or a list of things to avoid; the command only reads or searches files; or the file is not part of a user interface.
unless: Does `request` explicitly ask for feature cards or a grid of cards?
min: 0.85
action: deny
title: The three-card feature row
source: |
  An earlier hook system's default-look bans: "a three-card feature row". User, 2026-09-27: "block some of these bad design mistakes that Codex and sometimes even Claude make. They are just blatant telltale signs of the product being AI design, AI slop."
---
Icon + title + one-liner cards in a row is the section every generated landing page has. Readers skip it because it reads as a template, and it flattens features that differ in importance into equals.

Instead: rank the features. Show the most important one working (a screenshot, a demo, a before and after) and give the rest a compact list or a comparison table. Let the layout follow the content, not a card grid.
