---
event: tool
tools: [Write, Edit, MultiEdit, apply_patch, Bash]
ask: Does `input` write visible interface copy (headings, taglines, buttons) built on generic hype words: unlock, elevate, supercharge, seamless, effortless, empower, revolutionize, transform your, next-generation, game-changing, or 'the future of'?
yes: Headlines or buttons such as 'Unlock the power of your data', 'Elevate your workflow', 'Seamless integration', 'Supercharge your team'
no: Plain descriptive copy, words in code identifiers or comments, or copy the user supplied. The pattern is only named in prose, comments, documentation, a lint rule, a test, or a list of things to avoid; the command only reads or searches files; or the file is not part of a user interface.
unless: Does `request` supply this copy or explicitly ask for this wording?
min: 0.85
action: deny
title: Hype copy
source: 'a private style guide vocabulary spikes ("leverage, elevate, harness", "seamless, robust", "supercharge, unleash, unlock"). User, 2026-09-27: "block some of these bad design mistakes that Codex and sometimes even Claude make. They are just blatant telltale signs of the product being AI design, AI slop."'
---
Hype verbs ('Unlock', 'Elevate', 'Supercharge') and adjectives ('seamless', 'effortless') are the vocabulary of generated copy. They fit any product, so they tell the reader nothing about this one.

Instead: say literally what it does, for whom, and with what result: 'Send invoices from your phone and get paid in two days', not 'Elevate your billing'. Use the product's nouns and real numbers the user gave you.
