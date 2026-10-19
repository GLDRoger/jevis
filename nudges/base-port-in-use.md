---
hook: port-in-use
---
A port is already in use. A server you or the user started is probably still running. Check what owns it (`lsof -i :<port>`). If it's your own earlier dev server, reuse it. Don't kill a process you didn't start, and don't silently switch ports; tell the user if it isn't clear whose it is.
