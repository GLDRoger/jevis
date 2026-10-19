---
event: prompt
ask: Does `request` ask the agent to design, build, or restyle a page, site, or screen that people will look at?
yes: Visual interface work, new or existing
no: Backend, data, scripts, prose, questions, or a small visual fix the user fully specified
min: 0.8
when: { wants_change: ">=0.6", visual: ">=0.6" }
family: gpt
action: context
title: Pages that move
source: |
  Simulated design sessions, Sep 27-28 2026 (8 pages per arm). Frame-by-frame animation on 0 of 8 bare Codex pages and 1 of 8 Codex + Jevis pages, against 6 of 8 Claude Code + Jevis pages; scroll-driven motion on 0 and 1 of 8, against 3 of 8.
  The user, reviewing those pages, Sep 28 2026: "Claude Code makes amazing animations, scroll-based and moving page elements, and does that instinctively ... get all these animation-related abilities ... into Codex".
---
Codex's pages come out still: the layout and copy are designed, but nothing moves unless a hover asks it to.

Instead: give the page one or two motion moments with a job: a scroll-linked scene where scrolling moves the story along, a live element that shows the product working (a wheel turning, a tide rising to now), or state changes that ease instead of jump. Use transform and opacity, never hide content until an animation runs, and honor prefers-reduced-motion.
