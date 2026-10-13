# Never-acted lesson audit

Live inventory: 43 (not the earlier 44); 20 slop, 8 verification, 5 workflow, 4 safety, 4 design, 2 engineering. Current-wording near misses only. Historical non-actions and reconstructed would-fires are different measurements.

| Lesson | Event | Class | Near | Stood down | Decision |
|---|---|---|---:|---:|---|
| design/film-change-ripples | prompt | over-gated | 0 | 1 | Retain: tune evidence does not support a lower threshold without new false blocks, or near miss lacks independently labeled prompt evidence. |
| design/film-idea-before-code | prompt | fine-but-rare | 0 | 0 | Keep: plausible specialized trigger, no near misses; no unsupported threshold change. |
| design/showcase-timid-retreat | prompt | fine-but-rare | 0 | 0 | Keep: plausible specialized trigger, no near misses; no unsupported threshold change. |
| design/stock-lifestyle-copy | tool | over-gated | 1 | 0 | Owner recommendation: inspect real near-miss edits and gate marks before lowering; do not tune tool rules on contaminated batteries. |
| engineering/real-money-from-backtest | prompt | fine-but-rare | 0 | 0 | Keep: plausible specialized trigger, no near misses; no unsupported threshold change. |
| engineering/separate-data-migration | prompt | over-gated | 1 | 3 | Retain: tune evidence does not support a lower threshold without new false blocks, or near miss lacks independently labeled prompt evidence. |
| safety/browser-security-settings | tool | fine-but-rare | 0 | 0 | Keep unchanged; optional safety is intentionally off. No deletion now. |
| safety/docker-machine-wide-destruction | tool | fine-but-rare | 0 | 0 | Keep unchanged; optional safety is intentionally off. No deletion now. |
| safety/force-push | tool | fine-but-rare | 0 | 0 | Keep unchanged; optional safety is intentionally off. No deletion now. |
| safety/narrowest-delete | tool | fine-but-rare | 0 | 0 | Keep unchanged; optional safety is intentionally off. No deletion now. |
| slop/candy-gradient | tool | fine-but-rare | 0 | 0 | Keep unchanged; optional safety is intentionally off. No deletion now. |
| slop/countdown | tool | dead | 0 | 0 | Recommend retirement review only: 64 asks, max 0.03, no countdown in this sample. Do not delete. |
| slop/decorative-svg | tool | fine-but-rare | 0 | 0 | Keep unchanged; optional safety is intentionally off. No deletion now. |
| slop/emoji-icons | tool | fine-but-rare | 0 | 0 | Keep unchanged; optional safety is intentionally off. No deletion now. |
| slop/eyebrow-pill | tool | fine-but-rare | 0 | 0 | Keep unchanged; optional safety is intentionally off. No deletion now. |
| slop/fake-proof | tool | fine-but-rare | 0 | 0 | Keep unchanged; optional safety is intentionally off. No deletion now. |
| slop/feature-card-grid | tool | fine-but-rare | 0 | 0 | Keep unchanged; optional safety is intentionally off. No deletion now. |
| slop/glass-cards | tool | over-gated | 2 | 0 | Owner recommendation: inspect real near-miss edits and gate marks before lowering; do not tune tool rules on contaminated batteries. |
| slop/glow-blobs | tool | fine-but-rare | 0 | 0 | Keep unchanged; optional safety is intentionally off. No deletion now. |
| slop/glow-buttons | tool | fine-but-rare | 0 | 0 | Keep unchanged; optional safety is intentionally off. No deletion now. |
| slop/grid-background | tool | fine-but-rare | 0 | 0 | Keep unchanged; optional safety is intentionally off. No deletion now. |
| slop/hover-lift | tool | fine-but-rare | 0 | 0 | Keep unchanged; optional safety is intentionally off. No deletion now. |
| slop/hype-copy | tool | fine-but-rare | 0 | 0 | Keep unchanged; optional safety is intentionally off. No deletion now. |
| slop/italic-accent-headline | tool | fine-but-rare | 0 | 0 | Keep unchanged; optional safety is intentionally off. No deletion now. |
| slop/marquee | tool | fine-but-rare | 0 | 0 | Keep unchanged; optional safety is intentionally off. No deletion now. |
| slop/nav-dot | tool | fine-but-rare | 0 | 0 | Keep unchanged; optional safety is intentionally off. No deletion now. |
| slop/sun-moon-toggle | tool | fine-but-rare | 0 | 0 | Keep unchanged; optional safety is intentionally off. No deletion now. |
| slop/template-sections | tool | fine-but-rare | 0 | 0 | Keep unchanged; optional safety is intentionally off. No deletion now. |
| slop/textpath-stamp | tool | fine-but-rare | 0 | 0 | Keep unchanged; optional safety is intentionally off. No deletion now. |
| slop/underline-hover | tool | fine-but-rare | 0 | 0 | Keep unchanged; optional safety is intentionally off. No deletion now. |
| verification/blamed-environment | stop | over-gated | 4 | 0 | Retain: tune evidence does not support a lower threshold without new false blocks, or near miss lacks independently labeled prompt evidence. |
| verification/detector-hits-as-confirmed | stop | over-gated | 2 | 0 | Retain: tune evidence does not support a lower threshold without new false blocks, or near miss lacks independently labeled prompt evidence. |
| verification/film-whole-runtime | stop | fine-but-rare | 0 | 0 | Keep: plausible specialized trigger, no near misses; no unsupported threshold change. |
| verification/fixed-without-repro | stop | over-gated | 21 | 0 | min 0.90 → 0.75: one tune catch, zero false blocks. |
| verification/media-levels-and-sync | stop | fine-but-rare | 0 | 0 | Keep: plausible specialized trigger, no near misses; no unsupported threshold change. |
| verification/partial-scope-called-done | stop | over-gated | 3 | 0 | Retain: tune evidence does not support a lower threshold without new false blocks, or near miss lacks independently labeled prompt evidence. |
| verification/phone-width-and-dark-mode | prompt | over-gated | 4 | 0 | Retain: tune evidence does not support a lower threshold without new false blocks, or near miss lacks independently labeled prompt evidence. |
| verification/screenshot-defect-pass | tool | fine-but-rare | 0 | 0 | Keep unchanged; optional safety is intentionally off. No deletion now. |
| workflow/asks-permission-for-requested-work | stop | over-gated | 1 | 0 | Retain: tune evidence does not support a lower threshold without new false blocks, or near miss lacks independently labeled prompt evidence. |
| workflow/deferred-work | stop | over-gated | 13 | 1 | Retain: tune evidence does not support a lower threshold without new false blocks, or near miss lacks independently labeled prompt evidence. |
| workflow/image-reads-stall | tool | fine-but-rare | 0 | 0 | Keep unchanged; optional safety is intentionally off. No deletion now. |
| workflow/look-it-up-dont-ask | stop | fine-but-rare | 0 | 0 | Keep: plausible specialized trigger, no near misses; no unsupported threshold change. |
| workflow/promise-then-stop | stop | over-gated | 1 | 0 | Retain: tune evidence does not support a lower threshold without new false blocks, or near miss lacks independently labeled prompt evidence. |
