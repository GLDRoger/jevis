---
event: tool
tools: [Write, Edit, MultiEdit, apply_patch, Bash]
when: { marks.plain_read: false }
ask: Does `input` write user-interface code that adds an endlessly scrolling horizontal strip (a marquee or ticker) of brand values, adjectives, or slogans?
yes: @keyframes that translate a duplicated row across the screen forever, <marquee>, or classes like marquee, ticker, ribbon
no: A live data ticker the product needs (real prices, real scores), a strip of real customer logos or real work, a carousel the user controls, or no endless strip. The pattern is only named in prose, comments, documentation, a lint rule, a test, or a list of things to avoid; the command only reads or searches files; or the file is not part of a user interface.
unless: Does `request` explicitly ask for a marquee, ticker, or scrolling strip?
min: 0.85
action: deny
title: The marquee ribbon
source: |
  An earlier hook system's default-look bans: "a marquee ribbon of brand values". User, 2026-09-27: "block some of these bad design mistakes that Codex and sometimes even Claude make. They are just blatant telltale signs of the product being AI design, AI slop."
---
An endless ribbon of values or logos is filler motion that generated pages reach for to feel lively. It pulls the eye away from content, repeats words nobody reads twice, and ignores reduced-motion settings more often than not.

Instead: remove it. If the words matter, set them once as a readable list; if the logos are real, show a static row with the customers' permission.
