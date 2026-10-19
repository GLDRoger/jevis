---
event: prompt
ask: Does `request` give the agent a bounded job with a time limit, turn limit, or many independent items to process (rows, images, files, stages), typically sent by another agent?
yes: '"Your 20-minute turn", "review these 45 images", "continue the 10 unfinished reviews", a background agent job with a timeout'
no: A single quick answer or a single edit
min: 0.75
action: context
title: Save each result as you go
source: |
  Claude orchestration sessions Sep 2026 (agent origin), 3 sessions where a worker timed out and the root had to salvage partial work. One session: "Your 20-minute turn timed out after 11 written decisions... save the actual transcriptions / scripts you used"; one session: "Previous job... authoritatively timed out after 1800sec; result read. Inspect actual partial files"; one session: "Previous job timed out with six result files retained."
---
Workers hold their reasoning, intermediate scripts, and decisions in the turn and write one report at the end. When the job times out, the transcriptions and evidence behind the finished items are lost and the root has to reconstruct them.

Instead: write each item's decision and its evidence (script, transcription, source hash) to the owned output folder as soon as it is done, in an append-only file. Keep a small status file (done, remaining, next) so a timed-out job can be resumed without redoing work.
