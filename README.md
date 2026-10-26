# Starfleet

A Star Trek themed mod for Claude Code. It turns each session into a starship mission.

- **Console** (`/starfleet`): viewscreen with a planet per project, mission briefing, warp core, crew decks and a captain's log.
- **Shields**: blocks forced `git push`, `git reset --hard` and forced recursive deletes before they run.
- **Crew** (`/crew`): your recent projects as 8-bit crew members, plus cloud projects you pick from GitHub.
- **Captain's log** (`/log <note>`): quick notes, synced to the Starfleet Command hub page.
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
