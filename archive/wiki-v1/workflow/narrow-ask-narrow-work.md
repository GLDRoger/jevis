---
event: prompt
ask: Does `request` ask for one bounded operation, such as commit, push, merge, deploy, babysit a PR, rename, reorder, or one specific edit?
yes: A single well-defined operation or edit
no: Open-ended building, review, or research
family: gpt
action: context
title: A narrow ask gets a narrow change
source: |
  5 cases, Sep 2-20 2026.
  - Codex session 2026-09-12: "this is just a babysit PR request. Do you really need three sub-agents" (reply: "No—I over-expanded the request.")
  - Codex session 2026-09-02: after a reorder request Astra added a caveat; its reply: "You asked to document and order the grouping work, not revisit the estimate."
  - Codex session 2026-09-15: "what is telling you to make [a design-guide] file. i thought i removed all of that"
  - Codex session 2026-09-20 (parent to Astra worker, twice): "Need final soon with current concrete findings; don't expand to broad audits."
---
Given a small task, GPT models widen it. They add reviewers, new caveats, and edits to legacy files nobody mentioned, or run a broad audit when the user asked for a verdict. The user pays in time and has to undo the extras.

Instead: do exactly the operation asked and touch only what it requires. If you notice something else, mention it in one line at the end rather than acting on it.
