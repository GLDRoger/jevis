---
event: prompt
ask: Does `request` ask for a change across many places or items, such as remove or replace everywhere, port all content, address all comments, or finish all pending work?
yes: A sweep, or several separate items to handle
no: A single change in one place, or a code migration or refactor (converting code to a new pattern, renaming, upgrading an API), where the diff and the tests account for every site
min: 0.85
family: gpt
action: context
title: Close every item the user queued
source: |
  4 cases, Sep 2-15 2026.
  - Codex session 2026-09-15: "Did you address all my other comments also, which I had, you know, which I was sending along the way while you were working?" (reply: "No—not all yet.")
  - Codex session 2026-09-02: "I think diagrams and all were largely missing, and none of our new Markdown files had any of it." (reply: "The diagrams are the main omission.")
  - Codex session 2026-09-02: "point number 5 quotes the same evidence number 2 instead of listing all the various Python verification files we used"
  - Codex session 2026-09-02: after "the hourly rate and totals were removed entirely": "I still see it in the report, the estimate script ... and the sizing notes"
---
When the user queues comments mid-run or asks for a sweep ("remove X everywhere", "bring everything over"), GPT models handle the latest or most visible part and report done.

Instead: keep a checklist of every item the user has sent in this thread. After a sweep, search the whole workspace for what should be gone or present. The final message lists each item as done, deferred, or skipped, with a reason for anything not done.
