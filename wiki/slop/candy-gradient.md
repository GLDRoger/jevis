---
event: tool
tools: [Write, Edit, MultiEdit, apply_patch, Bash]
when: { marks.plain_read: false }
ask: Does `input` write a page or section background that is a soft multi-stop pastel gradient wash: butter-yellow to peach to pink, mint to lavender, sherbet to cream, or similar candy tones?
yes: linear-gradient or radial-gradient backgrounds across a hero, section, or page with pastel stops such as #ffe6a8 to #ffc0da, or Tailwind from-amber-100 via-pink-100 to-purple-100
no: A single considered background tone, a gradient that is the brand's own documented color, or a gradient inside a small crafted mark. The pattern is only named in prose, comments, documentation, a lint rule, a test, or a list of things to avoid; the command only reads or searches files; or the file is not part of a user interface.
unless: Does `request` explicitly ask for a pastel or gradient background?
min: 0.85
action: deny
title: The pastel candy gradient
source: 'a private design law: "The pastel candy gradient background", "Drifting soft-blend gradient blobs (the candy aurora)".'
---
A page-filling pastel wash (butter into peach into pink, mint into lavender) signals 'AI startup landing' as loudly as the purple gradient does, just in a sweeter palette.

Instead: give the background one chosen, specific atmosphere for this brand: a single considered tone, a crafted image, or a grained gradient in one brand color with real falloff.
