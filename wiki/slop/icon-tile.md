---
event: tool
tools: [Write, Edit, MultiEdit, apply_patch, Bash]
ask: Does `input` write user-interface markup or styles that place an icon or logo inside a filled or bordered tile, circle, or rounded square used as a feature bullet, card header, or hero visual?
yes: A single icon centered in a soft-colored rounded box (for example a div with bg-indigo-100 rounded-xl p-3 holding an icon), or a brand or social logo sitting on a colored chip
no: A bare icon placed on the surface, an app's avatar photo, a real button whose icon is its label, or no icon. The pattern is only named in prose, comments, documentation, a lint rule, a test, or a list of things to avoid; the command only reads or searches files; or the file is not part of a user interface.
unless: Does `request` explicitly ask for icons in tiles or boxes?
min: 0.85
action: deny
title: Icons in colored tiles
source: 'a private design law: "Oversized icon in a colored tile", "An icon or a logo with a box behind it".'
---
An icon parked in a soft-colored tile is the component-kit feature bullet: every generated page has a row of them, and the tile adds nothing but the machine-made look. The same holds for logos on a chip.

Instead: place the icon or logo on the surface as the bare mark, sized and colored with intent. If it needs separation, get it from the mark's weight, color, and spacing, never from a tile behind it.
