---
event: tool
tools: [Write, Edit, MultiEdit, apply_patch, Bash]
when: { marks.plain_read: false }
ask: Does `input` write a countdown timer: boxes or numbers for days, hours, minutes, and seconds counting down?
yes: A row of tiles with DAYS / HRS / MIN / SEC counting down to a sale, launch, or drop
no: A countdown to a real, dated event the user named, or a timer that is the product's function. The pattern is only named in prose, comments, documentation, a lint rule, a test, or a list of things to avoid; the command only reads or searches files; or the file is not part of a user interface.
unless: Does `request` give a specific date or time for the event, or explicitly ask for a countdown? A product launch or drop without a stated date does not count.
min: 0.85
action: deny
title: The fake countdown
source: 'a private design law: "Countdown timer": "a stock urgency widget dropped in whether or not anything is actually ending".'
---
A countdown to nothing is a stock urgency widget: it invents a deadline the business does not have.

Instead: leave urgency out unless the user gave a real date. If there is one, state it plainly with the date.
