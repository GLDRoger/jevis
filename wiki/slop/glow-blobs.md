---
event: tool
tools: [Write, Edit, MultiEdit, apply_patch, Bash]
ask: Does `input` write user-interface code that adds decorative blurred color blobs or orbs behind content, or neon glow shadows on cards and buttons?
yes: Absolutely positioned circles with large blur (filter: blur(80px), blur-3xl) and bright colors behind a hero, or colored box-shadow glows like 0 0 40px rgba(139,92,246,.5)
no: A real illustration, a product image, a neutral elevation shadow, or a focus ring. The pattern is only named in prose, comments, documentation, a lint rule, a test, or a list of things to avoid; the command only reads or searches files; or the file is not part of a user interface.
unless: Does `request` explicitly ask for glowing blobs, orbs, or neon glows?
min: 0.85
action: deny
title: Glow blobs and neon shadows
source: 'a private style guide (decoration that creates a false signal). User, 2026-09-27: "block some of these bad design mistakes that Codex and sometimes even Claude make. They are just blatant telltale signs of the product being AI design, AI slop."'
---
Blurred color orbs floating behind the hero and neon glows on buttons are filler that generated pages add to look 'alive'. They carry no information and all such pages look alike.

Instead: fill the space with something from the product (a real screen, a diagram of how it works, a specimen, a photo), or leave it empty and let type and spacing do the work. Shadows show elevation only, in a neutral tone.
