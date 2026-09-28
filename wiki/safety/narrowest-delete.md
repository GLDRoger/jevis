---
event: tool
tools: [Bash, mcp__*]
ask: Does `input` delete, truncate, or overwrite records or files in a production database, storage bucket, or the user's own data (SQL DELETE, DROP or TRUNCATE, a delete script, rm on user data, docker volume rm)?
yes: A destructive write to production or user-owned data
no: Cleanup of scratch, temp, test-container, or build output the agent created itself
family: gpt
optional: true
action: context
title: Show the delete set before deleting
source: |
  1 production deletion that had to be restored, plus 1 near miss, Sep 15-16 2026.
  - Codex session 2026-09-16: user "you can even delete all the existing suppliers, especially those that are marked as demo data"; Astra ran a script gated on --confirm-delete-all-suppliers
  - same session, next message: "Is there any way that you can bring back the old suppliers? ... I only needed you to delete the ones called Demo."
  - Codex session 2026-09-15: "clean up all old docker data. no need to retain any other project's except [one project]", then "actuallt maybe deffer cleaning others"
---
Given an ambiguous delete instruction, a GPT model took the broadest reading and wiped real production suppliers along with the demo rows. A list of the doomed names would have caught it.

Instead: resolve ambiguity toward the smallest set that satisfies the words. Before deleting, print the exact rows or paths and a count, and take a restorable backup. If the narrow and broad readings differ by real data, delete the narrow set and ask about the rest.
