---
event: prompt
ask: Does `request` ask to change the look of an existing page or component (colors, hero, layout, theme, email template) in a product that has a phone layout or a dark mode?
yes: Restyling a hero, recoloring a site, changing a card or email design, reworking a sidebar
no: A new page from scratch (see design/open-page-default), backend work, or the user asked for one specific viewport or theme only
min: 0.75
when: { wants_change: ">=0.6", visual: ">=0.6" }
action: context
title: Check the phone and the other theme
source: 'Claude sessions Aug-Sep 2026, 4 defects visible only at another width or theme, in 3 sessions. one session: "it looks especially bad on mobile"; one session, after the fix: "it still looks bad in mobile... the hero section is too long veriticaly in mobile"; one session: "dark mode entirely broke this email"; one session: "at certain resolutions it causes it to instead expand rather than collapse"'
---
A restyle gets checked at the desktop width and default theme it was designed in. The overlay that works on a wide photo wall stains a phone screen, and the email that reads on white breaks in dark mode.

Instead: after the change, capture the page at 390px, a middle width around 900px, and a wide desktop, in each theme the product supports, and fix what breaks. For email, check a dark-mode client rendering too. Report the widths and themes you checked.
