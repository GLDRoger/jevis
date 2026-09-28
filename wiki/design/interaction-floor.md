---
event: prompt
ask: Does `request` ask the agent to build or restyle an interface with controls a person clicks, types in, or toggles?
yes: New or restyled buttons, forms, menus, lists, or app screens
no: Static documents, images, films, or backend-only work; or the change touches copy only
min: 0.75
when: { wants_change: ">=0.6", visual: ">=0.7" }
action: context
title: The interaction floor
source: |
  An earlier hook system's interaction floor, added Sep 24 2026 after design-review findings. Count: 1 logged Stop block, Sep 26 2026: "No prefers-reduced-motion handling. Provide a reduced-motion alternative."
---
New interfaces ship with hover colors and little else: no pressed state, no visible keyboard focus, no reduced-motion handling, and state changes that pop instead of moving.

Instead: give every control hover (inside `@media (hover: hover)`), `:active`, and `:focus-visible` with 120–200 ms transitions on transform, opacity, or color. Animate open, close, add, remove, and select; honor `prefers-reduced-motion`; check the layout from 320 px to 1440 px.
