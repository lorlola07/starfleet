# Starfleet

A Star Trek themed mod for Claude Code. It turns each session into a starship mission.

- **Console** (`/starfleet`): viewscreen with a planet per project, mission briefing, warp core, crew decks and a captain's log.
- **Shields**: a seatbelt against Claude running common destructive commands by mistake: forced or branch-deleting `git push`, `git reset --hard`, `git clean -f`, forced `git checkout`, `git branch -D`, forced recursive deletes, recursive deletes of `~`, `/` or `.`, and `find -delete`. It reads the command the way the shell does, so it also catches these inside `bash -c`, `$(…)`, `sudo`, `xargs` and quotes, and it ignores them when they're only text (an `echo` or a commit message). It is not a sandbox: it can't see inside script files, and someone set on getting past it can. For hard limits, add deny rules to your Claude Code permission settings.
- **Make it so**: when Claude ends on a question, `make it so` (or `engage`) is offered as a one-key reply. It approves only the one step Claude proposed, and the approval is written into your message, so you see exactly what Claude is told. It isn't offered when the question is about deleting, resetting, force-pushing, deploying or merging.
- **Crew** (`/crew`): your recent projects as 8-bit crew members, plus cloud projects you pick from GitHub.
- **Captain's log** (`/log <note>`): quick notes, synced to your own Starfleet Command hub page.
- **Starfleet Command hub**: a private claude.ai page for your log, crew and mission history. The first time you press Sync, Claude publishes your own copy from `assets/hub.html` and remembers its link. `/hub` shows the link, `/hub <url>` points the mod at a hub you already have, and `/hub clear` forgets it.
- **Missions**: each session records its dates, models, plugins, files and screenshots, and syncs them to the hub.
- **Eject core** (`/eject-core`): writes a handoff document so a new chat can pick up the work.

Other commands: `/bridge`, `/red-alert`, `/translator`, `/captain-mode`, `/service-record`, `/starship`, `/warp-core`.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install starfleet --marketplace lorlola07/starfleet
```

Answer `y` to add the marketplace, then pick a scope.

From a shell:

```bash
claude plugin install starfleet --marketplace lorlola07/starfleet
```
