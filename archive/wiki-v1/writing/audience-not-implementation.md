---
event: tool
ask: Does `input` add or change user-facing text (UI labels, landing or marketing copy, a video script or narration) that contains implementation details or insider terms, such as pixel sizes, file or route names, internal ids, "unknown" placeholders, tech-stack words, or official jargon a lay reader would not use?
yes: '"reads at 360px", "open/files", "(version unknown)", "deterministic, no model calls", "TypeScript", "cadre"'
no: Code identifiers, developer docs, comments, logs, or copy whose audience is engineers
min: 0.8
tools: [Edit, Write, MultiEdit, apply_patch]
action: context
title: Copy speaks to the reader, not the build
source: 'Claude sessions Sep 2026, 5 corrections in 2 sessions. one session: "I don't think the line should read 360px. That really doesn't mean anything to judges, users, or anybody"; one session: "Let's not waste time on... whether it's TypeScript, whether it's deterministic"; one session: "cadre might be too difficult for common man"; one session: "wait actually why is it even stating open/files"'
---
Details the agent knows from building the thing leak into what people read: viewport sizes, route names, determinism claims, raw fallback strings, and formal vocabulary the audience does not use.

Instead: write for the named reader (judge, citizen, accountant, customer). Say what they can do and why it matters, in their words and their market's terms. Keep build facts in code and docs, and replace raw fallbacks such as "(version unknown)" with real states.
