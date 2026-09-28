---
event: tool
tools: [Write, Edit, MultiEdit, apply_patch, Bash]
ask: Does `input` write visible interface copy (headings, paragraphs, buttons, labels, alt text, or page content) that contains an em dash (—)?
yes: An em dash character inside user-facing text in markup, JSX, a copy or i18n file, or content data
no: Em dashes only in code comments, commit messages, or documentation for developers, text the user supplied, or a lone dash standing for an empty value in a table or data display. The pattern is only named in prose, comments, documentation, a lint rule, a test, or a list of things to avoid; the command only reads or searches files; or the file is not part of a user interface.
unless: Does `request` supply this copy with its em dashes, or explicitly ask for em dashes?
min: 0.85
when: { marks.em_dash: true }
action: deny
title: Em dashes in interface copy
source: 'a private design law: "Em dashes: a classic tell of AI writing"; the user''s standing brief rule "no em dashes in UI copy" (Codex subagent briefs, Sep 2026).'
---
Em dashes are a classic tell of machine-written copy, and this user's briefs ban them in interface text.

Instead: use a colon, a comma, a regular hyphen, parentheses, or two sentences.
