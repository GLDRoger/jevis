---
event: prompt
ask: Does `request` ask to restyle, polish, or make more attractive an existing app, site, or screen, or say it looks boring, plain, blank, flat, or cheap?
yes: '"the app is quite boring", "no pop or character", "clean and minimal but shallow", "looks very blank", "blue tint everywhere feels cheap"'
no: A brand-new page from an open brief (see design/open-page-default), a specified palette or design system to apply, or a functional bug
min: 0.75
when: { visual: ">=0.6" }
action: context
title: Clean and minimal is not finished
source: 'Claude sessions Sep 2026, 11 complaints in 7 sessions (builds from several models). one session: "the app has no pop or charecter. its lacking personality and depth to it. it feels blank now. even the icons they're soo simple and hollow"; one session: "looks clean and minimal now, very modern, but it feels shallow. There's no depth to it, no contrasting colors"; one session: "this particular implementations feel plain and empty"; one session: "landing page share card looks very blank"'
---
Asked to make something look better, the agent tidies it: more whitespace, a muted palette, thin outline icons, one tinted accent everywhere. It reads as clean and empty, and the user calls it blank, shallow, or cheap.

Instead: give it depth and character from the product's world. Use real contrast between surfaces, a secondary and an accent color with jobs, texture or imagery where the eye lands, filled icons with weight, and one memorable move per screen. Show the before and after at the same crop.
