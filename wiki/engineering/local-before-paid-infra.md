---
event: prompt
ask: Does `request` ask to host something that has no hosting yet, or to convert or process a batch of documents, media, or data files?
yes: New hosting, a one-off conversion, or a batch processing job
no: Deploying to hosting the project already uses, code and content changes, or refactoring or converting source code
min: 0.85
family: gpt
action: context
title: Try local and existing infrastructure first
source: |
  2 Sol sessions, Sep 26-27 2026; one job was abandoned.
  - Codex session 2026-09-26: Sol asked to provision a paid document server; user: "or can't we process those .doc files locally and then replace the server version with them"
  - same: "hmm or else forget it. stop all work here. i'll tell the client to convert to docx and use"
  - Codex session 2026-09-27: Sol proposed an always-on cloud VM; user: "can't deploy on vercel or aws ?"
---
GPT models meet one-off conversions and short-lived apps with new, always-on paid infrastructure and a chain of approval questions. The user abandoned one job over it.

Instead: first check what already runs locally or in accounts the project uses, such as Vercel, AWS, or existing servers. Do one-time conversions locally and upload the results. Propose new paid infrastructure only when those options can't work, and include the monthly cost and a teardown plan.
