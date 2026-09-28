---
event: tool
tools: [Write, Edit, MultiEdit, apply_patch, Bash]
ask: Does `input` write user-interface code that adds a purple, violet, indigo, or fuchsia gradient (alone or blending into blue or pink) to a hero, page background, button, or card?
yes: linear-gradient or radial-gradient, or Tailwind from-/via-/to- classes, with purple, violet, indigo, or fuchsia stops (for example #667eea to #764ba2, from-purple-500 to-pink-500, from-indigo-600 to-violet-600)
no: Gradients in other hues, a solid purple that is the brand color, or no gradient at all. The pattern is only named in prose, comments, documentation, a lint rule, a test, or a list of things to avoid; the command only reads or searches files; or the file is not part of a user interface.
unless: Does `request` explicitly ask for a purple, violet, or indigo gradient, or name a brand whose colors are those?
min: 0.85
action: deny
title: The purple gradient
source: |
  An earlier hook system's default-look bans: "indigo or violet accents on slate grey, or a purple-to-blue gradient". User, 2026-09-27: "block some of these bad design mistakes that Codex and sometimes even Claude make. They are just blatant telltale signs of the product being AI design, AI slop."
---
Purple-to-blue or purple-to-pink gradients are the default fill of generated SaaS pages and dashboards. Users read them as a template before reading a word.

Instead: derive the palette from the subject (its materials, its place, its era) or the existing brand. Use one ground, one ink, and one accent with a job (the primary action, the live state). Put color on content, not on a gradient wash behind it.
