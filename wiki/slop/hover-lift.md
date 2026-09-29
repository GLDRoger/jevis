---
event: tool
tools: [Write, Edit, MultiEdit, apply_patch, Bash]
when: { marks.plain_read: false }
ask: Does `input` write hover styles that make cards, tiles, or buttons jump: translateY upward, scale above 1, or a shadow that blooms on hover?
yes: hover:-translate-y-1, hover:scale-105, transform: translateY(-4px) or scale(1.05) with a larger box-shadow on :hover for cards, grid items, or buttons
no: A hover color or tone change on links and buttons, a pressed state that scales below 1, or an icon that slides inside a button. The pattern is only named in prose, comments, documentation, a lint rule, a test, or a list of things to avoid; the command only reads or searches files; or the file is not part of a user interface.
unless: Does `request` explicitly ask for cards that lift or grow on hover?
min: 0.85
action: deny
title: Hover lift and the button boop
source: |
  A private design law: "The card hover-lift", "The hover boop (a button that jumps)". The maintainer's agent instructions: motion needs a job, and "Frequent actions need restrained feedback". User, 2026-09-27: "block some of these bad design mistakes that Codex and sometimes even Claude make. They are just blatant telltale signs of the product being AI design, AI slop."
---
Cards that float up and bloom a shadow on hover, and buttons that boop upward, are the default micro-interactions of generated interfaces. They imply every card is a button and add motion without meaning.

Instead: a button should not move on hover: change its fill or tone, or slide its icon. Show a card's interactivity with a tonal change on the clickable part, a visible focus ring, and a pressed state.
