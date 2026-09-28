---
event: tool
ask: Is `input` a Read of a raw extracted video frame, a full-page screenshot, or one of many image files read one after another (for example /tmp/ref/f05.png, f11.png, f40.png)?
yes: Reading frame dumps from ffmpeg one by one, very tall full-page captures, or a batch of large PNGs
no: One viewport-sized screenshot, a single contact sheet or tile, or an image the user attached
min: 0.75
tools: [Read]
action: context
title: Tile and shrink images before reading
source: 'Claude sessions Sep 2026, 3 film sessions stalled or interrupted while reading reference frames (one session, one session, one session), plus probe sessions debugging the hang. one session: "looks like it keeps getting stuck trying to read imaged"; one session: "13 minutes and no increase in tokens huh"; user screenshots are delivered at sizes like "original 1440x12573, displayed at 229x2000"'
---
Studying a reference video by reading frame after frame at full size stalls the session for minutes or kills it. Very tall page captures are shrunk until nothing in them is legible.

Instead: build one contact sheet with ffmpeg (for example `-vf "fps=1/5,scale=480:-1,tile=4x3"`) and read that, then read single frames only where detail matters. Capture pages at viewport height in sections instead of one full-page image.
