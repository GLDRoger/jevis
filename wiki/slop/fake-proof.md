---
event: tool
tools: [Write, Edit, MultiEdit, apply_patch, Bash]
ask: Does `input` write user-interface content that invents social proof: testimonials with made-up names, customer counts, ratings, uptime or growth figures, or a 'trusted by' row of company logos or names?
yes: Quotes attributed to invented people, figures like '10,000+ teams', '4.9/5', '99.9% uptime', '3x faster', gradient-circle initials standing in for customer photos, or logo strips of companies the user never mentioned
no: Figures and quotes the user supplied, real data the app computes, or clearly marked placeholder slots such as [Customer quote]. The pattern is only named in prose, comments, documentation, a lint rule, a test, or a list of things to avoid; the command only reads or searches files; or the file is not part of a user interface.
unless: Does `request` supply these testimonials, numbers, or customer names, or explicitly ask the agent to invent sample ones?
min: 0.85
action: deny
title: Invented social proof
source: 'the maintainer''s agent instructions: never invent numbers or stronger claims; a private style guide: "Do not invent numbers, personal texture, urgency, or stronger claims". User, 2026-09-27: "block some of these bad design mistakes that Codex and sometimes even Claude make. They are just blatant telltale signs of the product being AI design, AI slop."'
---
Invented testimonials, user counts, and 'trusted by' logos are false claims the user would have to find and delete before shipping. They are also the loudest sign a page was generated.

Instead: show proof the product really has (a real screenshot, a working demo, a spec, a price). Where the user must supply proof later, leave an obviously marked slot such as [Customer quote, name, role] and list those slots in your final message.
