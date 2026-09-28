---
event: prompt
ask: Does `request` point at an attached image or a design link as the look to match, as in "make it like this" or "in this style"?
yes: The image or link is offered as the target look
no: The image is context for a bug or feature (an error screenshot, an icon to use), or the attachment is not an image (a spreadsheet, a PDF)
min: 0.8
when: { wants_change: ">=0.6", visual: ">=0.5" }
action: context
title: Match the reference, invent the rest
source: |
  An earlier hook system's reference mode for attached media and design links, and its Sep 26 lessons: "only image attachments are references" and "an image in an existing app that the user did not point at as a look gets engineering". Count: 2 logged reference-mode prompts, one of them a false match.
---
Given a reference, the build drifts back to the agent's own defaults, or it copies the surface and leaves everything the image does not show generic.

Instead: match the reference's layout language, palette, type, density, and mood faithfully. Put the invention into what the reference cannot show: content, states, interactions, motion, and the screens it leaves out.
