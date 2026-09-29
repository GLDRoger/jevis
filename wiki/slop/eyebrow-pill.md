---
event: tool
tools: [Write, Edit, MultiEdit, apply_patch, Bash]
when: { marks.plain_read: false }
ask: Does `input` write user-interface markup that places a small rounded pill or badge above a hero headline to announce something (for example 'New', 'Introducing', 'Now in beta', 'Backed by', or a version)?
yes: A rounded-full bordered chip or badge with a short announcement sitting right above the main headline
no: Status badges inside an app's data (order status, tags), or no pill above the headline. The pattern is only named in prose, comments, documentation, a lint rule, a test, or a list of things to avoid; the command only reads or searches files; or the file is not part of a user interface.
unless: Does `request` explicitly ask for an announcement badge or pill above the headline?
min: 0.85
action: deny
title: The announcement pill
source: 'a private style guide (badges on every label). User, 2026-09-27: "block some of these bad design mistakes that Codex and sometimes even Claude make. They are just blatant telltale signs of the product being AI design, AI slop."'
---
A pill above the hero ('✨ Now with AI', 'Introducing v2') is a stock opener of generated pages. It pushes the headline down and announces news the product may not have.

Instead: start with the headline. If there is real news, put it where it belongs: a dated line in the page, a changelog link in the header, or the headline itself.
