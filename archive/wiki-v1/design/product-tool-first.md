---
event: prompt
ask: Does `request` ask for a new app or tool people use repeatedly (a tracker, editor, inbox, CRM, or workspace), or a redesign of one's screens, rather than a marketing page?
yes: A product people come back to for their own work
no: A landing page, campaign, portfolio, or one-off piece; or a feature, fix, or behavior change inside an existing app
min: 0.75
when: { wants_change: ">=0.6", visual: ">=0.7" }
action: context
title: A product is a tool first
source: |
  An earlier hook system's notes, Sep 24 2026: "product apps keep the user work above the fold, use a reading face for long text, and give data views full width. Critic: usability outranks direction purity"; its self-review line: "a person opening it for the tenth time finds their own work on the first screen". Count: a recurring design-review finding (number not recorded).
---
A strong visual concept gets applied to an app's structure: a masthead pushes the user's own work below the fold, long text is set in a display or mono face, and tables squeeze into a reading column.

Instead: the first screen shows the person's work (recent items, what is due, what changed). The concept flavors details (labels, rules, empty states), never the structure. Long text uses a reading face at 15–17 px with a 60–75 character measure; tables and boards take the full width.
