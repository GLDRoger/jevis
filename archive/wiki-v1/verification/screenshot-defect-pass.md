---
event: tool
ask: Is `input` the agent viewing a screenshot, rendered frame, or contact sheet of a user interface, page, or video it has just built or changed?
yes: Reading a .png/.jpg the agent captured of its own page, app, share card, or video frames; a browser screenshot tool call on its own local or deployed build
no: Images the user attached, reference images from elsewhere, diagrams, or screenshots of unrelated apps
min: 0.8
tools: [Read, "mcp__chrome__*", "mcp__*screenshot*"]
action: context
title: Read your own screenshot for defects
source: 'Claude sessions Aug-Sep 2026, 9 visual defects the user found in screens the agent had built and reported done, in 6 sessions; in one session, one session and one session the agent had read its own captures just before. one session: "Hey, why don't the lines match up on the audit page?"; one session: "The G and the L overlap because there is not enough line spacing"; one session: "there seems to be a blank white box on a blue background below the text"; one session: "the files window upload button is overflowing to the right"; one session (after "The desk is ready for you to view and test"): "The spreadsheet and the PDF viewer are completely broken."'
---
Screenshots get taken as proof and glanced at for "it renders". The user then finds the overlap, the clipped icon, the empty box, the off-center scene, the unfixed ribbon in the same frame.

Instead: read the capture as a critic, edge by edge. Check text overlapping text, lines or columns that do not align, content running past the right edge, clipped icons or glyphs, orphaned single words, empty boxes, off-center blocks, and scroll regions whose headers do not stay put. Fix what you find before reporting, and say which captures you inspected.
