---
event: prompt
ask: Does `request` ask for a new page, app, or dashboard whose visual style is left open, without asking for a terminal, data-console, or telemetry look?
yes: Open visual work where a mono, numbered-ledger look was not requested
no: The user asks for a technical, terminal, or data-dense look, or the project already uses one
min: 0.75
when: { wants_change: ">=0.6", visual: ">=0.7", open_ended: ">=0.5" }
family: gpt
action: context
title: The numbered-ledger house style
source: |
  An earlier hook system's notes, Sep 24 2026: "Picks showed Sol chose data and telemetry lenses whenever offered and converged on mono micro-labels with numbered rows"; its house-style check flagged 30% monospace text and 4 zero-padded numbers. Count: every pick where a telemetry lens was offered (number not recorded); one app built Sep 26 2026 used a single monospace face.
---
Given room, GPT models land on one house style whatever the subject: monospaced micro-labels, letter-spaced capitals, and zero-padded numbered rows (01, 02, 03).

Instead: keep monospace for code, ids, and figure columns, use tracked capitals for one kind of label at most, and build the structure from the subject's own materials and type.
