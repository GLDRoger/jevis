---
event: stop
ask: Does `final_message` deliver a rendered video or audio file with sound, while `evidence` shows no command after the last render that measured its audio (loudness, peaks, clipping) or checked audio against visual timing?
yes: An MP4 or WAV handed over after a render, with no ffmpeg volumedetect, loudnorm or ebur128 analysis, and no timing check of voice or sound effects against scene cues
no: Silent media, a render still in progress reported as such, or a message that reports measured levels and sync
min: 0.9
action: block
title: Measure the mix before handing over media
source: 'Claude sessions Sep 2026, 4 audio complaints on delivered films in 3 sessions; one session also: "Right now, it feels basic" (impact sounds). one session: "the background music is a little too quiet. We barely even know it's there."; one session (a Sol film reviewed in this session): "the bass is not calibrated, soem oprtions are crackling my speakers"; one session: "the visuals timing of the questions appearing and the audio playing didn't match sync"'
---
Films get checked by looking at frames. The sound is never listened to or measured, so music sits inaudibly under the voice, synthesized bass clips, and cues drift from the visuals.

Instead: run ffmpeg ebur128 or volumedetect on the final file. Aim for about -14 LUFS integrated, true peak below -1 dBTP, and music about 12 to 18 dB under the voice. Then list each sound cue's timestamp next to its visual event and fix any drift over about 80 ms. Report the numbers.
