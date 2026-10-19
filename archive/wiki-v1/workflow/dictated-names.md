---
event: prompt
ask: Does `request` contain a word that looks like a speech-to-text error for a project, product, model, or person the conversation or `workspace` already names, such as "Chagipati" for ChatGPT, "Jeff" or "Jeb" for Jev, or "Vercel agent" for Opus agent?
yes: A near-homophone of a known name, or a phrase that only makes sense once one word is replaced by a known name ("in summer" for "in short")
no: Typos that do not change meaning, or names that plausibly mean something new
min: 0.75
action: context
title: Dictated names are known names
source: 'Claude sessions Sep 2026, 5 user corrections of dictation mishearings in 2 sessions, plus uncorrected ones (Jeff, Jeb in one session). one session: "'Chagipati' mean chatgpt and by 'in summer' i meant in short"; one session: "i meant opus agent" (after "send a vercel agent"); one session: "Sorry, I meant [the project]."; one session: "i meant the openai provider in [the project]"'
---
The user often dictates. Model names, project names, and short phrases come through as near-homophones, and the agent takes them literally: a "Vercel agent" instead of an Opus agent, the Codex CLI's OpenAI provider instead of the project's own.

Instead: map sound-alike words to the names already in play (projects in the workspace, models in use, people in the thread) and proceed with that reading, stating it in a short clause. Ask only when two known names fit equally well.
