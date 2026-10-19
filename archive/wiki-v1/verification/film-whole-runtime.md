---
event: stop
ask: Does `final_message` present a finished film, animation, or time-based scene while `evidence.actions_after_last_edit` shows no step that rendered or captured frames from across its runtime?
yes: A time-based piece reported done without frames sampled beyond its opening
no: The actions include frame renders, contact sheets, or captures at several timestamps, or the piece is not time-based
min: 0.9
when: { claims_done: ">=0.6", "evidence.edited": true }
action: block
title: Films checked from their first second
source: |
  An earlier hook system's film check, calibrated on two builds of one rocket-launch film prompt: "a static-camera build had 3 neighboring pairs under 10 of 255 mean difference; a cinematic one had none under 25". Showcases needed two filmed drafts, and its film contract sampled six frames across the runtime. Count: 1 calibrated pair; one logged session, Sep 25 2026: the film passed after 9 drafts.
---
A film gets checked from its opening second, or not at all, so long stretches where the picture holds still, errors mid-run, and frame-rate drops go unseen.

Instead: render frames across the whole runtime (expose `renderAt(t)` or a frame-by-frame draw function), look at contact sheets and full-size transition frames, fix the weakest moments, and look again.
