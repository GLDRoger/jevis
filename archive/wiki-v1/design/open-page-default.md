---
event: prompt
ask: Does `request` ask for a new website, landing page, storefront, or app screen and leave most of its look (layout, palette, type) to the agent?
yes: A new page, site, or screen whose visual design is left open
no: The look is specified, an existing product's design applies, an image to match is attached, or nothing visual is being made
min: 0.8
when: { wants_change: ">=0.6", new_build: ">=0.5" }
action: context
title: The two default pages
source: |
  User, Sep 28 2026, after a banned cream palette pushed simulated pages dark: "Let's remove that ban on cream and warm editorial palette."
  Builds blocked by an earlier hook system's default-look checks, Aug-Sep 2026. One review, Sep 25 2026: "44% of your color use is the default warm-editorial palette (neutral + terracotta + sage + espresso + butter)". One build, Sep 26 2026: marquee, italic-accent headline, product on a circle.
---
An open brief pulls one of two first drafts. One is the SaaS page: centered hero on a soft gradient, three feature cards, a logo strip, and pricing, in Inter on near-white with a purple or blue accent. The other is the editorial template: a big serif headline with one italic word, a rotating stamp, and a marquee of values. The user has rejected both layouts. The palette is free: cream, dark, or bright are all fine when the subject's world gives them.

Instead: pick one concept from the subject's own world, or borrow a structure from outside its category (a timetable, a specimen drawer, a record sleeve). Let it decide layout, type, palette roles, and motion before writing markup. Then build every state a person meets: hover, focus, empty, loading, error, and a 390px phone.
