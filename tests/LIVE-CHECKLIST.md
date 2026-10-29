# Starfleet live checklist

What the tests can't see. After a `/reload-plugins`, check the items for whatever changed, about two minutes in all. The automated review (the `review:` tests in v3.test.tsx) covers reloads, every button, and narrow, medium and wide widths.

1. **Scroll:** while Claude is working, scroll the console to the top. It stays there. Then press a console button and scroll again, from the bottom up too. A shiver that Esc stops is the app keeping the focused button in view (see Known issues in the README), not the mod.
2. **Pictures:** the viewscreen and crew decks fill their boxes edge to edge. Project names under the crew are readable. The ship orbits smoothly while Claude works, with no jumps back to the left edge. The crew bob. While Claude works the crew hold their decks; when the turn ends, your project's crew member walks to its new deck once and stays there, with no jitter.
3. **Narrow and wide:** drag the console narrow, then wide. Nothing is cut off at the right edge. Buttons sit on an even grid.
4. **Remembered:** reload once more. The service record numbers, an acknowledged briefing, an unrecorded Captain's log draft, and open or closed sections are all as you left them.
5. **Manage crew:** press Manage crew. A separate tab opens and fits without scrolling: every project with its little sprite, then the bench, squares first. Change two projects with ◀ ▶ and press Save: their chat tags, the decks and planets follow. Add / remove asks inline with Keep first, and nothing ever spins the chat.
6. **Captain's log:** press Captain's log on the console. A log tab opens with the cursor in its field. Type a note, press Record, then press Esc. The console lists no entries, its Captain's log button reads in black, and it scrolls with no shiver. `/log a note` in the prompt box files one too.
7. **Log categories:** in the log tab, press 🐞 Bug, type a note, press Record. It lists under the 🐞 BUG section, and File as goes back to Note. Press the BUG header: it folds, and stays folded after a reload. On the hub, a project's Captain's log has the same filter bar and a colored pill per entry.
