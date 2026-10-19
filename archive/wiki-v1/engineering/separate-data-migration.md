---
event: prompt
ask: Does `request` involve migrating, re-encrypting, re-keying, or backfilling existing user data in a live app?
yes: Changes to how existing production data is stored, keyed, or shaped
no: Schema additions with no backfill, or local-only data
when: { risky: ">=0.5" }
family: gpt
action: context
title: Ship the feature apart from the data rewrite
source: |
  1 session, 4 user corrections, about 2 days of production errors, Sep 12-14 2026.
  - Codex session 2026-09-12: "Just explain to me, like why this is such a slow process?" (Astra: "I coupled two changes that didn't have to happen together")
  - same, Astra: "I should have separated those requirements and benchmarked the worker before rollout."
  - same: "before we deploy what's this going on in prod right now? two sentry errors were triggered"
  - same: "more sentry errors have opened up. review and fix asap"
---
A GPT model bundled an optional app-lock feature with a re-encryption of every stored field. It then rolled the slow, failure-prone migration worker out to production without testing it at scale.

Instead: ship the user-facing change without rewriting data when you can. If a data migration is unavoidable, make it resumable and idempotent and benchmark it on a production-sized copy. Roll it out behind a flag to one account first, and watch the error tracker before widening it.
