---
event: tool
tools: [Write, Edit, MultiEdit, apply_patch, Bash]
when: { marks.plain_read: false }
ask: Does `input` write page sections the request did not mention that come from the stock landing-page template: pricing tiers with a 'Most popular' badge, an FAQ accordion, a newsletter signup, or a closing 'Ready to get started?' banner?
yes: Added pricing cards, FAQ accordions, newsletter boxes, or final call-to-action banners that the user did not ask for
no: Sections the user requested, sections the product needs from its real content, or edits to sections that already exist. The pattern is only named in prose, comments, documentation, a lint rule, a test, or a list of things to avoid; the command only reads or searches files; or the file is not part of a user interface.
unless: Does `request` ask for pricing, an FAQ, a newsletter signup, or a closing call to action?
min: 0.8
action: deny
title: Template sections
source: 'a private style guide (gratuitous sections, competing calls to action); open-page-default (SaaS template: hero, feature cards, logo strip, pricing). User, 2026-09-27: "block some of these bad design mistakes that Codex and sometimes even Claude make. They are just blatant telltale signs of the product being AI design, AI slop."'
---
Pricing tiers, an FAQ, a newsletter box, and a 'Ready to get started?' banner get appended to generated pages by habit. Unrequested, they are invented content (fake prices, fake questions) the user has to delete.

Instead: build only the sections the brief and the product's real content support, and make each one earn its place in the page's order. Mention in your final message any section you think is missing, rather than inventing it.
