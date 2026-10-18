---
event: prompt
ask: Does `request` ask for a message the user will send to someone else on a chat channel (WhatsApp, Slack, a tweet, a client text), or ask for short conversational replies?
yes: '"give me a summary I can send on WhatsApp to the client", "what should I write in the tweet", "lets just talk, short messages"'
no: Reports, documents, specs, PR descriptions, or email the user asked to be detailed
min: 0.8
action: context
title: Length fits the channel
source: 'Claude sessions Sep 2026, 2 corrections in 2 sessions. one session (after a chat update written for a client): "Yo, that's too long. I'll send the link in the same message, but this is way too much text."; one session: "lets jsut talk. short back and forth messages. no essays from you please"'
---
Asked for a message for a client, the agent writes a changelog: headings, bullets, every change of the day. In casual conversation it answers with a structured essay.

Instead: a chat message to a third party is 2 to 4 plain sentences in the user's voice, carrying only what the reader must know or do. In back-and-forth talk, reply in a few lines and let the user pull detail.
