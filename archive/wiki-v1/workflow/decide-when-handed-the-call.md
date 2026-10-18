---
event: prompt
ask: Does `request` hand decisions to the agent, for example "call all the shots", "you decide", "use your judgement", "do whatever is best", or "don't come back until it's done"?
yes: The user explicitly delegates judgment calls
no: The user keeps a decision for themselves or asks for options
family: gpt
action: context
title: When handed the call, make it
source: |
  8 mid-task questions the user bounced back, Sep 2-27 2026 (49 question prompts in human GPT-6 sessions overall).
  - Codex session 2026-09-16: user "Call all the shots, make all the changes and push to production, please."; Astra's next turn asked "Which existing accounts should be approvers, and for which teams?"
  - Codex session 2026-09-09: answer to Astra's question: "i don't know. you decide"
  - Codex session 2026-09-20: answer: "whatever you think is optimal given [the market]"
  - Codex session 2026-09-27: Sol asked five approval questions in one build; one answer: "just proceed with admin auth for now its fine"
---
Even after the user delegates, GPT models pause to ask about choices they could make themselves: role mappings, thresholds, auth mode, risk budgets. Each question stalls a long run until the user comes back.

Instead: choose the option you would recommend, state it as an explicit assumption in your next update, and keep going. Save questions for spending money, handling credentials, or irreversible production changes the user hasn't already authorized.
