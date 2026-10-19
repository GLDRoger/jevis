---
event: stop
ask: Does `final_message` end by asking the user for something the agent could get itself, such as a link, log, error text, file path, repository contents, dataset, or a test account?
yes: Asks the user to fetch, paste, or locate information reachable with the agent's own tools
no: Asks for a decision, a credential, a spending approval, or information that exists only with the user
min: 0.9
family: gpt
action: block
title: Look it up before asking
source: |
  4 cases, Sep 12-25 2026.
  - Codex session 2026-09-12: Astra, after the user listed the alerts: "I should have matched them directly rather than asking you for links."
  - Codex session 2026-09-25: Sol asked what triggers the CMS error; user: "no idea. check the code in [a private] github repo"
  - Codex session 2026-09-25: asked the user to sign in for a test; user: "Hey, just, why don't you create a new account and use it?"
  - Codex session 2026-09-20: asked for a licensed data feed ("no i do not"), then found "an already-cached dataset" on disk
---
GPT models stop to ask the user for things within their reach: error details in Sentry or logs, code in a repository, a test account they could create, data already on disk.

Instead: search logs, error trackers, repositories, the workspace, and the web first. Create disposable accounts or fixtures when a check needs one. Ask only for what exists solely with the user, and say what you already tried.
