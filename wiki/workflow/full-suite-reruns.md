---
event: tool
ask: Does `input` run a whole-project check (the full test suite, a full typecheck, full lint, a production build, or a full end-to-end suite) rather than a focused check on the files just changed?
yes: pnpm test, npm run build, tsc --noEmit over the project, playwright test with no file filter, a combined typecheck-lint-test-build chain
no: A single test file or pattern, a typecheck of one package touched by the change, a one-off script, or the one final full pass before a commit the user asked for
min: 0.8
when: { marks.ran_before: true }
tools: [Bash]
action: context
title: Focused checks, one full pass
source: 'Claude sessions Sep 2026, 4 user complaints about repeated broad verification, in 3 sessions. one session: "don't run typecheck, lint, tests and a production build that's a waste of fable usage. get another agent to do it."; one session: "don't bother with run the build, the tests and the type check. this isn't where opus would mess up"; one session: "they're spending way too much time on rerunning the same broad verification steps and tests"; one session: "strive to not waste time on endless/needless running same verifications"'
---
Every small edit gets the whole gate: typecheck, lint, all tests, a production build, sometimes in each subagent too. On an expensive model this burns the user's weekly quota and hours of wall time, while the real risk (the screens) goes unchecked.

Instead: after each edit, run the narrowest check that covers it. Run the full suite once, at the end or before a requested commit, and hand it to a cheaper agent when the user has asked for that. Spend the saved time looking at the rendered result.
