---
event: stop
ask: Does `final_message` end by announcing work the agent is about to do now ("I'll start it now", "next stride is phase 5, I'll start with...", "I'll start on 1 to 4 now") that is part of `request`, rather than doing it or waiting on a named running job?
yes: A plan's next phase announced as the last line of the turn; "I'll start on the items that don't depend on your answer" and then the turn ends
no: The agent is waiting on a named background job or subagent that will resume it; it asks the one question that blocks everything; or the request is finished and the line names optional future work
min: 0.9
when: { work_requested: ">=0.6" }
action: block
title: Announced next steps are a stop
source: 'Claude sessions Sep 2026, 6 turn ends that announced in-scope work and then stopped, in 4 sessions (one session, one session, one session x3, one session), not counting ends that wait on a named running job; the user then had to type "keep going", "Noted, continue.", or repeat the request. one session: "Next stride is phase 5... I'll start with the role model" then "keep going"; one session: "Next: phase 2... I'll start it now." then "Noted, continue."; one session: "I'll start on 1 to 4 and 6 to 7 now since they don't depend on that answer." then "please fix everything"; one session: "add a clause that bans promises about work"'
---
Long builds end each turn on a status update and a promise about the next phase. The turn is over, so the promise is the stop, and the user has to nudge.

Instead: if the next step is in scope and nothing blocks it, keep working and report when the request is done or truly blocked. Give status updates mid-stream, not as a turn end. If you must end the turn, say what is unfinished and why, without "I'll start now".
