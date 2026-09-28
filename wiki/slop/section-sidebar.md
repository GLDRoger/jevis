---
event: tool
tools: [Write, Edit, MultiEdit, apply_patch, Bash]
ask: Does `input` write a sidebar or side rail that is badly built for navigation, meaning its links jump to sections of the same page (href="#section" anchors, scrollIntoView), or it is a narrow fixed rail of icons without visible labels, or it has no control to expand and collapse it?
yes: A <nav>, <aside>, or sidebar component whose items are same-page anchors, or an icon-only rail with a fixed narrow width, no text labels, and no collapse or expand toggle, where text like "Sign out" wraps onto two lines
no: A sidebar whose links go to different pages or routes with visible labels and a collapse control (for example shadcn/ui Sidebar with SidebarTrigger), a table of contents inside long documentation, or no sidebar. The pattern is only named in prose, comments, documentation, a lint rule, a test, or a list of things to avoid; the command only reads or searches files; or the file is not part of a user interface.
unless: Does `request` explicitly ask for a sidebar that scrolls to sections of the page, or for an icon-only rail?
min: 0.85
action: deny
title: The section-scrolling sidebar
source: 'User, 2026-09-27, with a screenshot of an app: "broken sidebar like these, especially those which only scroll to different sections on the same page are slop too. sidebars should only be used to nav to different pages and as well as they need to be obtimzed, they should have expand collapse controls and they need to scale responsively instead of being squished liek this example".'
---
A sidebar tells people "this app has places to go". Generated apps build one that only scrolls to sections of the same page, or squeeze it into a narrow rail of unlabeled glyphs where "Sign out" wraps onto two lines. Both waste the left edge of every screen and hide what the icons mean.

Instead: use a sidebar only to move between pages or routes. Give every item an icon from the project's library and a visible label, add an expand and collapse control (a labeled rail when collapsed, with tooltips), and on narrow screens turn it into a sheet or drawer opened from the header. shadcn/ui's Sidebar with SidebarTrigger does all of this. For sections within one page, use headings and, if the page is long, an in-content table of contents.
