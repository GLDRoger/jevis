---
event: tool
tools: [Write, Edit, MultiEdit, apply_patch, Bash]
ask: Does `input` load or set, as a page's display, heading, brand, or main typeface, one of the default Google fonts: Inter, Space Grotesk, Sora, Syne, Archivo, Onest, Hanken Grotesk, Figtree, Gabarito, Manrope, DM Sans, Work Sans, Fraunces, Cormorant, Playfair Display, Bodoni Moda, Young Serif, Instrument Serif, Newsreader, Bricolage Grotesque, Big Shoulders, JetBrains Mono, IBM Plex Mono, Fragment Mono, or Space Mono?
yes: A Google Fonts link, @import, next/font/google import, or font-family declaration that makes one of these the face for headings, the wordmark, or the whole page
no: system-ui or a self-hosted or licensed face (for example from Fontshare or Velvetyne), a font the project already uses for its brand, or a monospace face used only for real code and data. The pattern is only named in prose, comments, documentation, a lint rule, a test, or a list of things to avoid; the command only reads or searches files; or the file is not part of a user interface.
unless: Does `request` name this font, or does the project's existing brand already use it?
min: 0.85
action: deny
title: The default Google-font rotation
source: |
  A private design law: "Default Google fonts, the whole rotation", "Fonts: Archivo, and Inter everywhere", "Even the tasteful font swap"; an earlier hook system's default-font bans.
---
Nearly every free Google font reads as generated the moment it carries the brand, and the known 'tasteful' swaps (Instrument Serif, Bricolage, Newsreader) are the same move. The face is the first thing a reader sees.

Instead: carry the identity on a distinctive licensed or self-hosted face chosen for this brief (Fontshare Pally, Gambarino, Sentient, Tanker; Velvetyne faces), and set body text in system-ui. Look at candidates rendered before choosing, and do not reuse a face from another project.
