---
event: tool
tools: [Write, Edit, MultiEdit, apply_patch, Bash]
ask: Does `input` write hover styles where a link's or button's underline grows, wipes, or slides in (a pseudo-element whose width or scaleX animates from 0 on hover)?
yes: ::after underlines that animate width 0 to 100% or scaleX(0) to scaleX(1) on :hover, or Tailwind after:w-0 hover:after:w-full
no: A plain underline that is always there or appears without animation, or a tonal color change on hover. The pattern is only named in prose, comments, documentation, a lint rule, a test, or a list of things to avoid; the command only reads or searches files; or the file is not part of a user interface.
unless: Does `request` explicitly ask for an animated underline?
min: 0.85
action: deny
title: Growing-underline hovers
source: 'a private design law: "Underline-fill hover animations".'
---
An underline that grows or wipes in on hover is the reflexive 'look, it is interactive' flourish on nearly every generated nav and link.

Instead: change the state cleanly and quietly: a tonal color shift, a weight change, or a static underline. Do not animate underlines.
