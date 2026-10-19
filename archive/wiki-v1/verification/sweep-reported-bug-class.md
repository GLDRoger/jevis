---
event: prompt
ask: Does `request` report a visual layout defect in the agent's work (overflow, clipping, overlap, misalignment, text cut off or wrapping badly), usually with a screenshot?
yes: '"text overflowing on right side", "part of the image flows out of the right edge", "a single word has been pushed to a new line", "icon text clipping"'
no: Requests about colors, copy, or features with no layout defect; a defect in someone else's app
min: 0.8
when: { correction: ">=0.5", visual: ">=0.5" }
action: context
title: One layout bug means a class of them
source: 'Claude sessions Sep 2026, 5 reports that arrived one screenshot at a time for the same defect class, in 3 sessions. one session: "found a few more bugs. here this icon text clipping logic seems off"; one session, next day: "here the text overflowing on right side"; one session: "i find issues like this were part of the image is flow out of the right side edge"; one session: "a single word has been push to new line, fix"'
---
The default is to patch the one element in the screenshot. The same missing min-width, nowrap, or fixed width is usually in every sibling component, so the user keeps finding them one by one.

Instead: fix the reported element, then name the cause (for example "no min-width: 0 on flex children") and search for it across the codebase. Render the affected screens at 390px and a wide desktop width and check every instance, then report which other places you fixed.
