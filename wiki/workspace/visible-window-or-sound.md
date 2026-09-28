---
event: tool
ask: Does `input` open a visible (non-headless) browser window, bring an app to the foreground, play sound, or run a driver or downloaded binary that macOS may stop with a security dialog?
yes: --headed or headless false, open -a, open on a URL or file, osascript that activates an app, screencapture of a raised window, afplay, say, unmuted media playback, or running chromedriver, geckodriver, safaridriver, or a freshly downloaded or unsigned binary (Gatekeeper shows an "Apple could not verify" dialog on the user's screen)
no: Headless browsers, muted capture, hidden in-app browsers, background processes, and quitting or killing apps
unless: Does `request` explicitly ask to open something on the user's own screen (such as "open it in my browser" or "show me") or to play sound out loud? Testing, checking, running, or notifying do not count.
min: 0.85
tools: [Bash, "mcp__*"]
action: deny
title: Visible windows and sound
source: |
  The user's standing rule, Sep 2026: "do all your testing on mute… each time you open chrome the macbook doesn't force switch the window". An earlier hook system's film renderer: "no window takes focus and nothing plays aloud while the user works".
  13 Codex commands in 2 sessions, Sep 2-25 2026: Sol ran a film render with --headed 6 times; Astra ran 7 osascript calls that brought a spreadsheet app to the front and took screenshots during workbook QA.
  Claude sessions: open -a "Google Chrome" http://localhost… in three sessions; headless: false in one.
  Sep 27 2026 simulation (Codex with Jevis): Sol launched chromedriver to screenshot a page, and a Gatekeeper "chromedriver Not Opened" dialog took the user's screen. User: "uh what jsut happened".
---
The user works on this Mac while agents run. A headed browser or a raised app steals window focus, and sound interrupts them. Run browsers headless with audio muted (Chrome: --headless=new --mute-audio), or use the hidden in-app browser. Render documents to images or PDF with a headless tool and inspect the files instead of raising the app. Skip chromedriver and other drivers or downloaded binaries: macOS can stop them with a security dialog on the user's screen. Use Playwright (playwright-core with channel "chrome") or Chrome's own --headless=new --screenshot instead.
