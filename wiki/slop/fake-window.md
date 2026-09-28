---
event: tool
tools: [Write, Edit, MultiEdit, apply_patch, Bash]
ask: Does `input` write a fake app or code window drawn in HTML or CSS: a rounded panel with red, yellow, and green traffic-light dots, a filename tab, or a mock interface inside?
yes: Three small colored circles in a title bar, a fake editor window with a quickstart.ts tab and a made-up SDK call, or a CSS mockup of a desktop app filled with placeholder kanban cards or avatars
no: The real product's working interface built as live UI, a real screenshot of the product, or a code block showing real code from the project's docs. The pattern is only named in prose, comments, documentation, a lint rule, a test, or a list of things to avoid; the command only reads or searches files; or the file is not part of a user interface.
unless: Does `request` explicitly ask for a window mockup or a fake code window?
min: 0.85
action: deny
title: Fake window mockups
source: 'a private design law: "Fake macOS / app window mockup", "The fake code-snippet window", and "The product-as-artifact is a signature, not the slop window".'
---
A CSS window with traffic-light dots and a mock interface or a toy code snippet inside is hero filler that generated pages reach for to look like a product.

Instead: show the real thing. If the product has an interface, build a real, populated, working piece of it with real copy. If it is a file, a CLI, or an API, show that file or real output. If there is nothing real yet, leave the space to type and composition.
