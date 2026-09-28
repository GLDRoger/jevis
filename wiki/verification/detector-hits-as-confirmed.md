---
event: stop
ask: Does `final_message` report errors, defects, or false items as confirmed or real, where they were found by a regex, heuristic, script, or automated detector, and without saying each one was checked individually?
yes: '"14 formula defects found" from a regex sweep; "85 CONFIRMED false pairs" from a matching script; "evidence is missing" after one search path'
no: Each finding was verified one by one against the source, or the message labels them candidates that still need checking
min: 0.9
action: block
title: Detector hits are candidates, not findings
source: |
  Claude orchestration sessions Sep 2026 (agent origin), 3 root corrections in 3 sessions. One session: "your regex misses cases ... It is NOT safe to call 10 formula errors from regex"; one session: "Your 85 CONFIRMED false pairs may mean the detector itself has falsely accused the original"; one session: "stop assuming missing evidence! Your conclusion was falsified".
---
A quick detector gets written and its output counts are reported as the finding: "10 formula errors", "85 confirmed", "not recoverable". The detector has blind spots, and the parent agent or user acts on the count.

Instead: report detector output as candidates. Verify a sample or all of them against the source of truth with an exact method, report how many held up, and name the detector's known blind spots. Before concluding that evidence is missing, list the places you searched.
