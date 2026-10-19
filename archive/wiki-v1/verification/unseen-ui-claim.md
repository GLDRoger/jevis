---
event: stop
ask: Does `final_message` say that an interface, page, document, or other visual change is ready, fixed, working, or checked, while `evidence.actions_after_last_edit` shows no browser, screenshot, or render step after the last change to `evidence.ui_files_changed`?
yes: A claim that visual work is done or works, with no browser, Playwright, in-app browser, screenshot, or render step after the last UI edit
no: No such claim, the claim is marked untested, the changed files are not user-facing, or a browser, screenshot, render, or QA step ran after the last UI edit
min: 0.85
when: { evidence.edited: true }
action: block
title: A visual change nobody looked at
source: |
  An earlier hook system's claim check: 39 nudges, each a wrap-up after UI edits with no browser action since (32 in one session, Sep 25-27 2026); 15 of 74 turn endings claimed a browser check that predated their last UI change.
  6 Codex reports of visual work handed over as ready and broken, Sep 5-25 2026:
  - a Codex session (after "The latest candidate is running locally"): "login doesn;t work?"
  - a Codex session (after "Added the logo to every page"): "its cut off in every page"
  - a Codex session: "i still don't see any editable pivot in this page?"; "graphs charts are still failing"
  - a Codex session: "tested it visually in the browser?"
---
The final message says the visual work is ready, but nothing rendered it after the last change. Agents, GPT models especially, finish UI work on unit tests and a build, and the user opens it to find a broken login, a clipped logo, or a missing panel.

Open it in a headless or in-app browser, never a window that takes focus. Drive the changed flow the way a user would (click, type, submit, upload a real file where uploads changed), check a 390px width if layout changed, and look at what you captured. Then report what you saw. If you can't run it here, say it's unchecked.
