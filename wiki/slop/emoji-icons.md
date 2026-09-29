---
event: tool
tools: [Write, Edit, MultiEdit, apply_patch, Bash]
when: { marks.plain_read: false }
ask: Does `input` write user-interface markup or copy that uses emoji as icons, bullets, section markers, or decoration in headings, buttons, lists, or feature blocks?
yes: Emoji such as 🚀 ✨ ⚡ 💡 🎯 ✅ 🔥 📈 🛡️ placed as icons or ornaments in a page, app, or component
no: Emoji the user supplied in their content, emoji inside a chat or messaging product's user messages, or no emoji. The pattern is only named in prose, comments, documentation, a lint rule, a test, or a list of things to avoid; the command only reads or searches files; or the file is not part of a user interface.
unless: Does `request` explicitly ask for emoji in the interface?
min: 0.85
action: deny
title: Emoji as icons
source: 'a private style guide (badges on every label, decoration that crowds the workflow). User, 2026-09-27: "block some of these bad design mistakes that Codex and sometimes even Claude make. They are just blatant telltale signs of the product being AI design, AI slop."'
---
Emoji standing in for icons (🚀 fast, ✨ smart, 🔒 secure) is a telltale of generated interfaces. They render differently on every platform, clash with the type, and signal that nobody designed the icon set.

Instead: drop the icon when the label is enough, which is most of the time. When an icon earns its place, use the project's icon set (in a shadcn/ui project, its Lucide set), or one library chosen for the brand, at one size and weight, bare on the surface, with an accessible label.
