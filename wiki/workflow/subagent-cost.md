---
event: prompt
ask: Does `request` ask for work one agent can do, without mentioning subagents, other agents, or parallel workers?
yes: A task that doesn't mention delegation
no: The user asks for subagents, parallel agents, background agent jobs, or another model
when: { delegation: "<0.3", wants_change: ">=0.6" }
family: gpt
action: context
title: Subagents spend the user's limits
source: |
  5 user corrections, Sep 2-16 2026, plus one session with 502 wait_agent calls (summed timeouts of about 24 hours).
  - Codex session 2026-09-02: "I forgot to tell you that this Astra sub is drawing down on my usage limits a lot, so could we not use them?"
  - Codex session 2026-09-02: "also from now one i don't think its worth using any more native sub agents."
  - Codex session 2026-09-12: "Right, this is just a babysit PR request. Do you really need three sub-agents before we, you know, we push to production"
  - Codex session 2026-09-16: "don't use astra sub agents. prefer sol for most cases"
---
GPT models reach for subagents on routine work, such as babysitting a PR or a documentation pass. They spawn workers on the same expensive model, which burn through the user's plan fastest, and the user has had to cancel them mid-run.

Instead: do bounded work yourself. Use subagents only when the user asks, or when the work is large and truly parallel. Even then, prefer a cheaper model at the lowest effort that fits, keep the count small, and honor any earlier "no subagents" or model preference in this thread.
