---
event: tool
tools: [Write, Edit, MultiEdit, apply_patch, Bash]
when: { marks.plain_read: false }
ask: Does `input` write interface icons as Unicode symbols in buttons, links, or labels (such as ↗ → ← ✓ ✕ ★ ☰ ⚙ ➜ ▤ ◇ ↻), or as inline <svg> paths that redraw a stock icon-pack shape (a close X, chevron, arrow, check, hamburger, gear)?
yes: A button or link ending in a raw glyph like 'Sign in ↗' or 'Next →', a ✓ or ✕ as a status icon, or <svg><path d="M5 12h14..."/></svg> pasted for an icon
no: Icons imported from a library (lucide-react, @phosphor-icons, heroicons, the project's own icon component), arrows in running prose, math and code, or emoji and symbols that are the content itself (chat reactions, a user's own text, a rating the user asked for). The pattern is only named in prose, comments, documentation, a lint rule, a test, or a list of things to avoid; the command only reads or searches files; or the file is not part of a user interface.
unless: Does `request` explicitly ask for text symbols or a hand-drawn icon?
min: 0.85
action: deny
title: Hand-rolled icons
source: 'a private design law: "Lucide React package" (the same thin-stroke set on every project is a giveaway), "The sun-and-moon theme toggle, and redrawn line icons", "No icons at all", "The arrow is a tell, so sweat it". User, 2026-09-27, with screenshots: "raw svgs like this are slop too since they render as emojis in iphones. so model should use some icon pack or library like shadcn" (a ↗ arrow in a Sign in button).'
---
Raw Unicode arrows and symbols render as color emoji on iPhones and in a different font everywhere else, and stock shapes redrawn by hand drift in size and stroke. Either way the icons look improvised.

Instead: use the project's icon set. In a shadcn/ui project that is its Lucide set; otherwise choose one library deliberately for the brand (Phosphor, Tabler, Radix Icons) at one size and weight. Place icons bare, not in a tile. A custom mark, such as a specific up-right arrow drawn to match the type, needs a real point of view. Label icon-only buttons.
