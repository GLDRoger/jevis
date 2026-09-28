---
event: tool
tools: [Write, Edit, MultiEdit, apply_patch, Bash]
ask: Does `input` write button styles that give a fully rounded pill button a gradient fill, a colored glow, or a soft blurred shadow beneath it?
yes: rounded-full buttons with bg-gradient-to-r fills, box-shadow glows in the button's color (shadow-lg shadow-purple-500/50, 0 10px 30px rgba(accent)), or a blurred bloom under the button
no: Flat buttons with a solid fill, a tight directional shadow of a few pixels, or ordinary app buttons from the project's component library. The pattern is only named in prose, comments, documentation, a lint rule, a test, or a list of things to avoid; the command only reads or searches files; or the file is not part of a user interface.
unless: Does `request` explicitly ask for glowing, gradient, or pill-shaped buttons?
min: 0.85
action: deny
title: Glowy pill buttons
source: 'a private design law: "Glowy pill buttons", "The default CTA button pair", "Gradient pill with icon and text".'
---
A pill button with a gradient fill and a glow under it is the stock generated call to action. The blurred bloom under buttons and cards is one of the most common slop signatures.

Instead: style the button for this brand: a solid or tonal fill, a considered radius shared with the rest of the system, and a hover that changes fill or color without glowing or moving. If it needs lift, cast one tight, low-offset shadow tinted to the surface.
