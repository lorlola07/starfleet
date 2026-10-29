# Make Starfleet your own

Every part of Starfleet is plain code you can change, and you don't have to write it yourself. Open Claude Code in the mod's folder, say what you want in your own words, and Claude makes the change. This guide walks through each part of the console, what kind of thing it is, where it lives, and a prompt you can start from.

## Before you start (about 5 minutes, once)

1. **Get your own copy.** Fork this repo on GitHub, then clone your fork. An installed plugin gets replaced when it updates, so your changes belong in your own copy.
2. **Load your copy.** Start Claude Code with your folder as a plugin: `claude --plugin-dir ~/path/to/starfleet`. Turn off the installed version in `/plugin` so you don't run two.
3. **Ask Claude to use the mod skill.** Start your first message with "Use the plugin-authoring skill." It teaches Claude how mods are built, so the changes fit.
4. **See your change.** Run `/reload-plugins` after each change. Run `claude plugin test .` to check nothing broke.

A good prompt names three things: **which part** (use the names below), **what you want** it to look or act like, and **what to keep**. For example: "In the viewscreen, add a new planet. Keep the 8-bit style of the others."

## What the parts are made of

Knowing the kind of thing helps you ask for the right change.

- **Drawings** are SVG images, written as code. Most are pixel art: little grids of colored squares. You can ask for new shapes, colors and animation.
- **Text and labels** are plain words in the code. Ask Claude to reword them.
- **Buttons and fields** are mod elements, like a Record button. Ask for new ones, or to change what one does.
- **Sounds** are short `.wav` files in `assets/`. Swap in your own.
- **The hub** is a web page (`assets/hub.html`) that becomes your own private page on claude.ai.

## The parts, top to bottom

### 1. The frame (USS CLAUDE)
The orange LCARS header at the top of the console, with the ship's name and a code.
- **Kind:** drawing. **Where:** `lcarsFrameSvg` in `hooks/theme.ts`. The name is set in `hooks/console.tsx`.
- **Try:** "Rename the ship in the console frame from USS CLAUDE to USS [your name]."
- **Try:** "Make the console frame's colored bars match my color scheme: [your colors]."

### 2. The viewscreen and planets
The ship orbiting your project's planet. The arrows switch planets.
- **Kind:** animated drawing. **Where:** `viewscreenSvg` and the `PLANETS` list in `hooks/theme.ts`. Each planet is one entry with a `draw` function.
- **Try:** "Add a new planet to the viewscreen's PLANETS list: a [describe it] world. Match the style of the others and make it selectable with the arrows."
- **Try:** "Slow down the ship's orbit on the viewscreen."
- **Try:** "Swap the ship on the viewscreen for a [your ship] in the same pixel style."

### 3. Stardate, condition and status
The date, the colored CONDITION tag, and the lines for course, time and orders.
- **Kind:** text. **Where:** `stardate` in `hooks/shared.ts`, conditions in `hooks/console.tsx`, the course steps (`COURSE`) in `hooks/voyage.ts`.
- **Try:** "Change the stardate to show the full year."
- **Try:** "Rename the course steps from HOLDING ORBIT, SURVEYING… to [your words]."

### 4. Captain's log
The field and Record button for quick notes. Each note goes to your hub.
- **Kind:** field and button. **Where:** the log section in `hooks/console.tsx`. Saving and syncing is in `hooks/log.tsx`.
- **Try:** "Add a tag picker to the captain's log so I can mark a note as Idea, To-do or Bug, and show the tag on the hub."
- **Try:** "Change the captain's log heading to [your name]."

### 5. Last order
A short title for the last thing you asked Claude, so you know where you left off.
- **Kind:** text, written by Claude Haiku (turn this off with `/ai-summaries off`). **Where:** `ORDER_SYSTEM` in `hooks/console.tsx`.
- **Try:** "Make Last order titles plain and descriptive instead of starship orders."

### 6. Mission briefing
A summary of where the project stands, made from your log notes and the latest handoff.
- **Kind:** text, written by Claude Haiku. **Where:** `SYSTEM` in `hooks/briefing.ts`.
- **Try:** "Make the mission briefing end with a short list of next steps."

### 7. Crew decks and sprites
A crew member for each project. They walk between decks as Claude works: Sensors and Library while it reads, Engineering while it edits or runs commands, the Bridge when it's waiting on you.
- **Kind:** animated pixel drawings. **Where:** each sprite is a grid of letters in `SPRITES` in `hooks/shared.ts`, and each letter is a color from `CREW_PALETTE`. The decks are `DECKS` in `hooks/crew.tsx`, and `deckOfTool` in `hooks/shared.ts` decides which deck goes with which kind of work.
- **Try:** "Add a new crew sprite of [character], drawn as an 8 by 9 pixel grid like the others in SPRITES, with its own emoji tag."
- **Try:** "Add a deck called [name] that crew walk to while Claude [does something]."
- **Good to know:** the hub draws the same sprites, so ask Claude to add a new one to `assets/hub.html` too.

### 8. Main engineering (the warp core)
The core fills as the chat's context fills. Eject core writes a handoff and starts a fresh chat.
- **Kind:** animated drawing plus text. **Where:** `coreSvg` and the warning lines (`TIER_TEXT`) in `hooks/core.tsx`.
- **Try:** "Change the warp core warnings from Borg lines to [your theme]."
- **Try:** "Make the warp core warn me at 60% instead of 70%."

### 9. Service record and rank
Your running totals, with rank pips that grow as you go.
- **Kind:** drawing plus text. **Where:** `RANKS` and `pipsSvg` in `hooks/shared.ts`.
- **Try:** "Rename the ranks in RANKS and change how much it takes to reach each one."

### 10. Red alert
The pulsing red banner when Shields blocks something or the core nears full.
- **Kind:** animated drawing plus a sound. **Where:** `redAlertSvg` in `hooks/ops.tsx`.
- **Try:** "Make the red alert banner pulse slower."

### 11. Sounds
A chirp on button presses, a hail when Claude finishes a turn, and a klaxon for red alert.
- **Kind:** sound files. **Where:** `assets/chirp.wav`, `assets/hail.wav` and `assets/klaxon.wav`.
- **Try:** drop your own `.wav` in `assets/` with the same name. Or: "Play assets/[file].wav when I record a log note."

### 12. Colors
One set of colors runs the whole console.
- **Kind:** color values. **Where:** `LCARS` and `HEAD_COLOR` in `hooks/theme.ts`.
- **Try:** "Change the console's colors to [your palette]. Keep red for warnings and check the text stays readable."

### 13. Starfleet Command hub
Your private page for the log, crew and mission history.
- **Kind:** a web page. **Where:** `assets/hub.html`. Your copy is published from it when you press Set up my hub, or your first Close mission.
- **Try:** "In assets/hub.html, add a search box that filters log notes." Then republish your hub, or start a new one with `/hub clear` and Close mission.
- **Good to know:** your notes live in the hub's own storage, not in the page, so changing the page never loses them.

### 14. Shields
Blocks common destructive commands before they run.
- **Kind:** rules in code. **Where:** `hooks/shields.ts`, with tests in `tests/shields.test.ts`.
- **Try:** "Add [command] to what Shields blocks, with tests for ways it could be written."
- **Good to know:** Shields is a seatbelt, not a sandbox. Always ask for tests with a change here, and run `claude plugin test .`.

### 15. Commands and the computer's voice
Slash commands like `/log`, `/crew` and `/red-alert`, and Captain mode, where Claude answers as the ship's computer.
- **Kind:** commands and prompts. **Where:** each command is registered in the file for its part. Captain mode's voice is `CAPTAIN_PROMPT` in `hooks/takeover.tsx`.
- **Try:** "Add a /standup command that shows today's log notes for this project."
- **Try:** "Change Captain mode so the computer talks like [character or tone]."

## Bigger changes

You can change the whole theme too. Try: "Use the plugin-authoring skill. Retheme Starfleet as a [pirate ship / space station / bakery]: rename every heading and label, recolor the palette, and redraw the planets and crew to fit. Keep every feature working, and run the tests."

Go one part at a time, reload, and check it before moving on. If a change goes wrong, ask Claude to undo it, or use git to go back.
