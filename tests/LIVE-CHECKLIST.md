# Starfleet live checklist

What the tests can't see. After a `/reload-plugins`, check the items for whatever changed, about two minutes in all. The automated review (the `review:` tests in v3.test.tsx) covers reloads, every button, and narrow, medium and wide widths.

1. **Scroll:** while Claude is working, scroll the console to the top. It stays there.
2. **Pictures:** the viewscreen and crew decks fill their boxes edge to edge. Project names under the crew are readable. The ship orbits smoothly while Claude works, with no jumps back to the left edge. The crew bob. While Claude works the crew hold their decks; when the turn ends, your project's crew member walks to its new deck once and stays there, with no jitter.
3. **Narrow and wide:** drag the console narrow, then wide. Nothing is cut off at the right edge. Buttons sit on an even grid.
4. **Remembered:** reload once more. The service record numbers, an acknowledged briefing, an unrecorded Captain's log draft, and open or closed sections are all as you left them.
5. **Popups:** press − Remove project and pick a name. The popup names the project and Keep is the default. Press Escape or Keep and nothing changes.
