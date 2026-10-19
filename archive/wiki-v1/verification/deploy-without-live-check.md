---
event: stop
ask: Does `final_message` say something was deployed, released, or pushed to production, while `evidence.actions_after_last_edit` shows no request against the deployed service after the deploy command (curl, browser visit, function invoke, log or error-tracker read)?
yes: A production deploy is reported and nothing after it touched the live app, endpoint, or its logs
no: No production deploy this turn, a post-deploy request or log check appears after it, or the user said they will test it themselves
min: 0.9
family: gpt
action: block
title: Deployed means exercised in production
source: |
  5 production breakages the user found after a "deployed, tests passed" handoff, Sep 12-25 2026.
  - Codex session 2026-09-24 (Sol, after "deployed the report function ... all 40 function tests passed"): "doenloads now show error \" Failed to download report."
  - Codex session 2026-09-12 (Astra): "its been 12 hours since you pushed the latest changes to prod. nothing feels broken on the app but theres been a lot of different sentry errors"
  - Codex session 2026-09-16 (Astra): "i downloaded the latest prod version. why is [a balance column] negetive in every field?"
  - Codex session 2026-09-25 (Sol): "looks like we hit our first problem. admin is not assigned to [a location]"
---
GPT models treat green local tests plus a successful deploy command as proof and hand off. The user then finds the break in production hours or days later: failing report downloads, a storm of Sentry errors, wrong ledger totals, or a role the tests never covered.

Instead: after deploying, run the changed path on the live target with production-sized data and every affected role. Hit the endpoint, invoke the function, or load the page in a headless or in-app browser. Then read the platform logs or error tracker for the new release. If you can't authenticate, name the path that is still unverified.
