---
event: prompt
ask: Does `request` ask to write or rework the copy or story of a landing, marketing, or launch page for a product?
yes: Hero rewrites, "the landing page doesn't explain why I'd use this", a new marketing page that walks through the product
no: Visual-only tweaks with the copy settled, or in-app UI text
min: 0.8
when: { wants_change: ">=0.5" }
action: context
title: The landing page sells the job, not the mechanism
source: 'Claude sessions Sep 2026, 4 rounds of the same correction in 2 sessions. one session: "I still don't understand why I should use this, what it can do for me, or what benefit I can get"; one session: "Still, I don't think the Hero Section copy does a good enough job of convincing the use case"; one session: "I don't think you're still getting what I'm trying to say."; one session: "yes there's great features but none of that is conveyed to the viewer"'
---
The default hero describes how the product works (agents, applets, a workbench) and trusts the features to sell themselves. The reader never learns why they would switch.

Instead: open with the reader's job and pain in their words, then the result the product gives them. Follow with one concrete demonstration and an honest answer to "why not the tool I already use?". Read two landing pages from strong products in the same category before drafting, and match their information order.
