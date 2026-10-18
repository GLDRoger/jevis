---
event: prompt
ask: Does `request` ask the agent to design, build, restyle, or fix something people will look at (a page, an app screen, a component, a site)?
yes: Visual interface work of any size, new or existing
no: Backend, data, scripts, prose, questions, or a visual change the user has fully specified down to the values
min: 0.8
when: { wants_change: ">=0.6", visual: ">=0.6", "user.design_law": true }
action: context
title: The design law
source: |
  The maintainer keeps a design law file and cites it in agent briefs, Sep 2026: "Same rules as always (slop law, brand, tokens, no new deps...)". Fires only when such a file exists.
---
This user keeps a design law: the file JEVIS_DESIGN_LAW names, else ~/.jevis/design-law.md, ~/.claude/slop.md, or ~/.codex/slop.md. It lists the tells of generated design (fonts, palettes, components, whole-page layouts) and what the premium version looks like. Jevis refuses edits that add the clearest tells, and a design review reads the law when the turn ends.

Instead of meeting it at the refusal: read the law before you design, decide one signature and one world for this brief, and check the result against it before you finish. Where the user's request conflicts with the law, the request wins.
