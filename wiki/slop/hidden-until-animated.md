---
event: tool
tools: [Write, Edit, MultiEdit, apply_patch, Bash]
ask: Does `input` make visible content start hidden (opacity 0, visibility hidden, or translated off screen) and rely on JavaScript, an IntersectionObserver, a scroll timeline, or an animation library to reveal it?
yes: Sections, headings, text, or controls with opacity: 0 or class="opacity-0" until a class is added on scroll, animation-timeline: view() reveals, or Framer or motion initial={{ opacity: 0 }} on content
no: Hover or focus effects on content already visible, a modal or menu that is closed until opened, a loading skeleton, or reveals whose no-JavaScript fallback shows the content fully. The pattern is only named in prose, comments, documentation, a lint rule, a test, or a list of things to avoid; the command only reads or searches files; or the file is not part of a user interface.
unless: Does `request` explicitly ask for content to fade or slide in on scroll?
min: 0.85
action: deny
title: Content hidden behind an entrance animation
source: 'a private design law: "Never hide content behind an entrance animation (the invisible-content trap)": "the single most damaging motion mistake".'
---
Content that starts at opacity 0 and waits for JavaScript or a scroll timeline to appear renders as an empty void whenever the reveal does not fire: a background tab, an unsupported timeline, a throttled engine, a screenshot. This has shipped blank sections and empty search bars before.

Instead: keep content visible by default. Put motion on things already on screen (hover states, a sliding indicator, a counting number, parallax on a visible element), or animate position only so the no-JavaScript state still shows everything.
