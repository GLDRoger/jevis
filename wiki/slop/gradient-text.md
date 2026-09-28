---
event: tool
tools: [Write, Edit, MultiEdit, apply_patch, Bash]
ask: Does `input` write user-interface code that fills text with a gradient (background-clip: text or -webkit-background-clip: text with a gradient, Tailwind bg-clip-text with text-transparent)?
yes: A heading, word, or number is painted with a gradient through background-clip text
no: Solid-colored text, or a gradient used on a non-text background. The pattern is only named in prose, comments, documentation, a lint rule, a test, or a list of things to avoid; the command only reads or searches files; or the file is not part of a user interface.
unless: Does `request` explicitly ask for gradient-filled text?
min: 0.85
action: deny
title: Gradient-filled text
source: |
  An earlier hook system's default-look bans (purple-to-blue gradient); a private style guide (decoration that creates a false signal). User, 2026-09-27: "block some of these bad design mistakes that Codex and sometimes even Claude make. They are just blatant telltale signs of the product being AI design, AI slop."
---
Gradient-filled headline text is the most recognizable mark of a generated landing page. It lowers contrast, blurs the letterforms, and says nothing about the product.

Instead: set the text in one solid color from the palette and create emphasis with size, weight, a typeface change, or placement. If the page needs a moment of color, give it to one real object (a product shot, a chart, a single rule), not the type.
