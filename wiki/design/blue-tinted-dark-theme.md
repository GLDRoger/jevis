---
event: tool
tools: [Write, Edit, MultiEdit, apply_patch]
ask: Does `input` set dark-theme background or surface colors tinted blue, navy, or slate (such as #0f172a or #1e293b) rather than true or slightly warm neutrals?
yes: Large dark surfaces (page ground, sidebar, panels) carry a visible blue tint
no: The user or the project's existing tokens chose that color, the blue is an accent, or the theme is light
min: 0.8
action: context
title: Blue-tinted dark themes
source: |
  User feedback on an earlier hook system's design reviews: "A blue, navy, or slate tint across dark surfaces feels cheap." Measured on three well-known products (Notion, Linear, Vercel): dark-surface OKLab tint 0 to 0.003. Count: 1 direct user correction, 3 reference products measured.
---
Dark themes default to Tailwind slate or navy surfaces. This user reads that tint as cheap.

Instead: build dark surfaces from true or slightly warm neutrals (#191919, #202020, chroma near zero) and let the accent be the only hue on the page.
