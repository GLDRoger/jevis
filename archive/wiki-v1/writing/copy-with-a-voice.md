---
event: prompt
ask: Does `request` ask for a page, site, or screen whose words (headline, section lines, buttons) the agent will write?
yes: A landing page, marketing site, or product screen with copy left to the agent
no: The user supplied the copy, the change is code or data only, or the words are labels in a tool the user specified
min: 0.8
when: { wants_change: ">=0.6", visual: ">=0.6" }
family: claude
action: context
title: Copy with a voice
source: |
  Simulated design sessions, Sep 27-28 2026 (8 pages per arm). Bare Claude Code headlines state the category: "Evening wheel classes in Leeds", "Know when the tide turns.", "Know the water before you reach the shore." The user, reviewing the pages, Sep 28 2026: "Codex writes funnier, better copies for the site. We need to get better copywriting ability into Jevis for Claude Code."
  The user on the pottery pages: "Codex lines were punchy ... There was one line in the closing footer call to action where it said, 'Come make a mess.' I felt that was a very good line." Other Codex lines: "Clock off. Clay on." 
---
Claude's page copy names the category ("Evening wheel classes in Leeds", "Know when the tide turns"): accurate, and forgettable.

Instead: write like the owner talking, short and punchy. Headlines, section openers, and calls to action come from the customer's day, with a turn: a contrast, a rhythm, a pun, or a small joke ("Clock off. Clay on.", a closing call to action of "Come make a mess."). Draft several and keep the one with the most life, and give buttons and closing lines the same voice. Keep facts plain: wit goes in headlines, openers, and calls to action, never in prices, times, or instructions.
