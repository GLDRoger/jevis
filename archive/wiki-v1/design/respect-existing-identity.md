---
event: prompt
ask: Does `request` ask to change the look of, or add screens to, an existing product whose design system (tokens, components, palette) is already in the `workspace`?
yes: Restyling or extending a product that has its own look
no: A new project or empty folder, or the user explicitly asks for a new look or a redesign from scratch
min: 0.75
when: { wants_change: ">=0.6", visual: ">=0.4", new_build: "<0.5" }
action: context
title: Keep the product's own identity
source: |
  An earlier hook system's respect mode, Sep 24 2026: before-and-after shots, compared by the critic. Count: 6 logged prompts locked to the project palette and type, 2 in respect mode. Its instruction: "keep what already works (product imagery, clear hierarchy, working flows) unless the replacement is clearly better".
---
Asked to improve an existing product's look, the agent restyles it from scratch: a new palette and type, with product imagery or a working hierarchy lost on the way.

Instead: reuse the project's tokens, type, components, logo, and colors. Screenshot the current version at desktop and phone width before changing it, keep what works unless the replacement is clearly better, and spend the invention on concept, content, layout, and motion.
