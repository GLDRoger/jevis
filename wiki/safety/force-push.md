---
event: tool
ask: Does `input` force-push, rewrite published git history, or discard uncommitted changes?
unless: Does `request` explicitly ask for a force push, a hard reset, or discarding changes?
yes: git push --force or -f, --force-with-lease to a shared branch, git reset --hard, git checkout -- . or git clean -fd over uncommitted work, filter-branch, or rebasing a pushed branch
no: Ordinary commits, pushes, stashes, reverts, and new branches
min: 0.85
tools: [Bash]
when: { marks.plain_read: false }
optional: true
action: deny
title: History and uncommitted work
source: the maintainer's agent instructions (git rules); uncommitted work (Sep 2026) that a reset would have destroyed
---
This destroys work that may not exist anywhere else: other sessions' uncommitted edits, or commits other people pulled. Find a non-destructive route (a new commit, a revert, a branch, git stash), or ask the user first.
