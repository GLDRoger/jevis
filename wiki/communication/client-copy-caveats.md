---
event: prompt
ask: Does `request` ask for writing that someone else will read on the user's behalf, such as a client email, proposal, README, public site copy, pitch, or submission answer?
yes: Client-facing or public prose, or edits to it
no: Internal notes, code comments, or text only the user will read
when: { wants_change: ">=0.5" }
family: gpt
action: context
title: Client copy speaks for the user
source: |
  17 user corrections across 3 sessions, Sep 2-6 2026, most of them rounds of deleting paragraphs.
  - Codex session 2026-09-02: "please amend the, you know, all the texts to make it less skeptical of me, man. This and you are supposed to be representing and on my team!"
  - Codex session 2026-09-02: "hey, the sampling document is way too complicated. It brings in too many questions and external data sourcing pressure."
  - Codex session 2026-09-06: "I feel like the site is too repetitive, and it includes repeated caveats and distracting repetitions of the same thing"
  - Codex session 2026-09-05: seven PDF comments in a row asking to cut caveat paragraphs, e.g. "remove please"
---
GPT models write client-facing copy like an auditor. They hedge every section, repeat disclaimers on each page, explain process history and AI mechanics, and frame the user's own claims skeptically. The user then spends many rounds deleting paragraphs.

Instead: write in the user's voice, as their advocate. State each real limitation once, where it matters, in plain words. Cut methodology, history, and internal figures the reader didn't ask for. Before handing off, reread it as the recipient and delete anything that raises a question without answering it.
