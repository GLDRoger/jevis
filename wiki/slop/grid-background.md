---
event: tool
tools: [Write, Edit, MultiEdit, apply_patch, Bash]
when: { marks.plain_read: false }
ask: Does `input` write a background of faint grid or graph-paper lines (repeating linear gradients or an SVG pattern of lines, often faded with a radial mask) behind a hero, section, or the whole page?
yes: background-image with two repeating-linear-gradient line sets, bg-[linear-gradient(to_right,#8882_1px,transparent_1px)], a grid SVG pattern, or a dotted grid laid under content
no: A real technical drawing, a few ruler ticks or crop marks, a data chart's gridlines, or a spreadsheet or calendar grid that is the content itself. The pattern is only named in prose, comments, documentation, a lint rule, a test, or a list of things to avoid; the command only reads or searches files; or the file is not part of a user interface.
unless: Does `request` explicitly ask for a grid, graph-paper, or blueprint background?
min: 0.85
action: deny
title: Graph-paper backgrounds
source: 'a private design law: "Grid / graph-paper background" and "The faint grid background (restated, because it keeps happening)".'
---
A faint grid behind the hero is the default backdrop generated pages reach for whenever a plain background feels empty. Faint or not, a sheet of graph paper under everything reads as slop.

Instead: give the surface a considered tone or a real atmosphere (a grained gradient in one brand color, a crafted image), or leave it plain. A technical look earns its place only as a few specific marks, never a full-bleed grid.
