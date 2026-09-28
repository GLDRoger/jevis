---
event: tool
tools: [Write, Edit, MultiEdit, apply_patch, Bash]
ask: Does `input` write a large serif headline that sets one or two words in italic (an <em> or <i> inside the h1, or an italic accent span) as the stylistic accent?
yes: An h1 or hero title in a serif face with one italic or differently colored italic word, like 'Coffee, made <em>slowly</em>'
no: Italics for a title of a work or real emphasis in body text, or a headline without an italic accent word. The pattern is only named in prose, comments, documentation, a lint rule, a test, or a list of things to avoid; the command only reads or searches files; or the file is not part of a user interface.
unless: Does `request` explicitly ask for an italic word in the headline?
min: 0.85
action: context
title: The italic accent word, on autopilot
source: |
  A private design law: "The big serif statement block", "The multi-line headline (and the dangling accent word)", and, as the premium version, "The signature serif headline". An earlier hook system's default-look bans ("a big serif headline with one italic accent word"), and one build, Sep 26 2026. User, 2026-09-27: "block some of these bad design mistakes that Codex and sometimes even Claude make. They are just blatant telltale signs of the product being AI design, AI slop."
---
A big serif headline with one italic word is the signature move of generated editorial pages, and it goes wrong in known ways: set in Cormorant or a Didone, as a lone 'statement' block, or with the accent word dangling at the end of a three- or four-line stack. Done on purpose it can be the page's strongest element.

Instead: make it a decision, not a reflex. Keep the headline to one or two composed lines with the emphasis inside the phrase, use a face chosen for this brand, and make the emphasis tonal. If the last project used the same move, choose another.
