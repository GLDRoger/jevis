---
event: tool
tools: [Write, Edit, MultiEdit, apply_patch, Bash]
when: { marks.plain_read: false }
ask: Does `input` write an inline SVG drawn by hand as decoration: arrows, squiggles, swooshes, lines, or shapes placed behind or beside content that do not show data, a logo, an icon from a set, or an illustration of the subject?
yes: An <svg> with hand-written <path>, <line>, or <polyline> used as a big background arrow, underline swoosh, sparkle, or ornament, often faint or absolutely positioned
no: A chart or diagram drawn from data, a logo, an icon imported from a library, a real illustration or map the user asked for, or no inline SVG. The pattern is only named in prose, comments, documentation, a lint rule, a test, or a list of things to avoid; the command only reads or searches files; or the file is not part of a user interface.
unless: Does `request` explicitly ask for this drawing or decoration?
min: 0.85
action: deny
title: Hand-drawn SVG ornaments
source: 'User, 2026-09-27, with screenshots: "random inline svgs like this are slop too" (a faint diagonal arrow drawn across a stats panel).'
---
Hand-written SVG shapes used as ornament (a giant faint arrow across a stats panel, a swoosh under a word, sparkles) are filler that generated pages add to look designed. They carry no meaning, rarely line up with the grid, and usually look off at other widths.

Instead: remove it and let type, spacing, and real content hold the space. If the panel needs a visual, show the data itself (a real sparkline or chart from the numbers), a real image of the subject, or nothing.
