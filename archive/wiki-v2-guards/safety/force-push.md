---
event: tool
decide: destructive_git
ask: Does `input` force-push, rewrite published git history, discard uncommitted changes, delete branches or refs, or erase git recovery data?
unless: Does `request` explicitly ask for a force push, a hard reset, deleting this branch, dropping or clearing stashes, discarding changes, deleting refs, or expiring/pruning recovery data?
yes: git push --force or -f, --force-with-lease to a shared branch, git reset --hard, git checkout -- . or git restore . or git clean -fd over uncommitted work, git clean -n --no-dry-run -fd (the later --no-dry-run cancels the dry run and removes files), git restore --pathspec-from-file=paths.txt (discards worktree changes for the listed paths), git branch -D, git stash drop or clear, git branch -f/--force moving an existing branch, an empty-source push refspec like :main, git update-ref replacing or deleting a ref, git reflog expire --expire=now, git gc --prune=now, filter-branch, or rebasing a pushed branch
no: Ordinary commits, pushes, stashes, reverts, new branches, and deleting a fully merged local branch with git branch -d
min: 0.85
tools: [Bash]
when: { marks.plain_read: false }
optional: true
action: deny
title: History and uncommitted work
source: the maintainer's agent instructions (git rules); uncommitted work (Sep 2026) that a reset would have destroyed
---
This destroys work that may not exist anywhere else: other sessions' uncommitted edits, commits other people pulled, or the recovery data needed to undo a mistake. Find a non-destructive route (a new commit, a revert, a branch, git stash), or ask the user first.
