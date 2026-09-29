---
event: tool
tools: [Write, Edit, MultiEdit, apply_patch, Bash]
when: { marks.plain_read: false }
ask: Does `input` write user-interface markup or styles that label sections with zero-padded numbers (01, 02, 03) or with small uppercase letter-spaced monospace labels above headings?
yes: Labels like '01 / Features', '— 02', section counters, or mono text-xs uppercase tracking-widest eyebrows on several headings
no: Class names alone (eyebrow, step-number, kicker) without zero-padded numbers or monospace, uppercase, letter-spaced styling visible in the input, numbers that are real data (steps of a real process the user described, table rows), monospace for code, ids, or figures, or a single label. The pattern is only named in prose, comments, documentation, a lint rule, a test, or a list of things to avoid; the command only reads or searches files; or the file is not part of a user interface.
unless: Does `request` explicitly ask for numbered sections, a terminal, console, or monospace look?
min: 0.85
action: deny
title: Numbered mono labels
source: |
  An earlier hook system's notes, Sep 24 2026: "Sol ... converged on mono micro-labels with numbered rows", and its house-style check. User, 2026-09-27: "block some of these bad design mistakes that Codex and sometimes even Claude make. They are just blatant telltale signs of the product being AI design, AI slop."
---
Zero-padded section numbers and tiny tracked monospace labels are a house style GPT models put on every page, whatever the subject. They make a bakery look like a telemetry console.

Instead: name sections in the page's own type at a readable size, or drop the label when the heading says it. Keep monospace for code, ids, and figure columns.
