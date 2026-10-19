---
event: prompt
ask: Does `request` ask for a new dashboard, admin overview, or analytics screen and leave its layout and look to the agent?
yes: A new data screen whose structure and styling are open
no: The user specified the layout or widgets, or the project's existing dashboard design applies
min: 0.75
when: { wants_change: ">=0.6", visual: ">=0.5", correction: "<0.5" }
action: context
title: The template dashboard
source: |
  An earlier hook system's dashboard bans and idea cards, Sep 24 2026: "a row of four stat cards with sparklines, one big line chart, and a table underneath". Count: 5 banned defaults and 5 ideas; 4 logged dashboard prompts, all detailed specs that were left alone.
---
The default dashboard is four stat cards with sparklines, one big line chart, and a table, in indigo or violet on slate, with donut charts for many-part data and charts that answer no question.

Instead: lead with the three numbers that matter, each answering "compared to what?" (delta against the previous period and the target). Let every KPI drill into the rows behind it, share one date range and filter across all widgets, and invent a company whose numbers add up everywhere they appear.
