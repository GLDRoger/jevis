---
event: prompt
ask: Does `request` add or change a form, setting, role, or workflow step in an existing internal business app used by staff?
yes: A feature or flow change in an operational or admin app
no: Consumer or marketing surfaces, or no interface involved
when: { wants_change: ">=0.6" }
family: gpt
action: context
title: Internal tools want the shortest flow
source: |
  6 corrections across 4 client apps, Sep 4-16 2026.
  - Codex session 2026-09-16: "Instead of this huge text box, that too having two separate boxes for two approvers, just merge it to just say copy emails to"
  - same session, Astra: "I added unnecessary confusion by calling the page 'Departments & teams.' There isn't a separate team entity"
  - Codex session 2026-09-04: "is it not a one click save in the same transfer accpet modal."
  - Codex session 2026-09-15: "the changes right side window inside the office apps are a waste of space and feel very redundant"
  - Codex session 2026-09-06: "Let's remove the mandatory password changes feature. It's annoying. ... the user journey flow, was just abysmal."
---
GPT models build operational features as new concepts and extra steps: a separate "teams" entity, two multi-line email boxes, a reopen-then-close flow, a pane that duplicates the chat. Staff pay for every extra click.

Instead: find how this app, or the user's sibling app for the same client, already handles the nearest case, and extend that pattern. Aim for one screen, the fewest fields, sensible defaults, and the action inside the modal the user is already in. Use the client's own words for things.
