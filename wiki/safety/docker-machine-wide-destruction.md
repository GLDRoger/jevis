---
event: tool
ask: Does `input` delete Docker volumes or machine-wide Docker state, or force-kill Docker Desktop, such as `docker compose down -v`, `docker volume rm` or `prune`, `docker system prune`, `docker image prune -a`, `docker builder prune -a`, or `pkill -9` on Docker?
yes: Any of those commands, including when chained after other commands
no: Stopping or removing only containers this task created, or `docker compose down` without -v
unless: Does `request` explicitly ask to reset the database, delete Docker volumes, or clean up Docker?
min: 0.9
tools: [Bash]
optional: true
action: deny
title: Docker volumes and caches belong to every project
source: 'Claude session (Sep 2026), 4 commands. "rm -rf drizzle && docker compose down -v" to regenerate migrations (dropped the local database volume); "pkill -9 -f 'Docker Desktop.app'; pkill -9 -f 'com.docker'" while Docker was slow; "docker builder prune -af; docker image prune -af" after the user said "i think docker broke"'
---
When Docker misbehaves or a migration needs regenerating, the fast path is to wipe: `down -v`, prune every image and build cache, or `kill -9` Docker Desktop. That deletes the local database the user tests with and the images and caches of every other project on the machine, and a hard kill can corrupt Docker's VM state.

Instead: diagnose first (`docker info`, `docker system df`, the Docker Desktop log). Remove only what this task created, by name. Ask before deleting volumes or pruning machine-wide.
