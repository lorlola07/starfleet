# Changelog

## 0.4.9

### Added
- **About** (`a` in the console): a short guide to every part and what it connects to.
- **Add and remove projects** from the console's crew section and `/crew`, by name and after asking. Up to 11 crew members, with Guinan, Q and Quark joining the roster.
- Each chat in a crew project gets that crew member's emoji in front of its name, and the default planet is drawn in the project's crew color.
- Worktree chats count as their project's crew member. A failing test run in one puts the project in sickbay.
- From 70% context the warp core asks once per tier whether the work is mid-task, and recommends compact or eject.
- Demo GIF and interactive demo link in the README.

### Changed
- Stardates read month and day, then the year (1028.26). Older entries convert on their own.
- Captain's log notes and deletes go straight to your hub page, with no chat turn.
- The console's once-a-second redraw pauses while you type in the log, so the field keeps its focus.
- Eject writes a handoff that replaces the last one and drops nothing.
- Crew members keep their sprite and deck while Claude works, and walk to a new deck once.
- Plugin listing details: homepage, repository, keywords and category.

### Fixed
- Shields reads a here-document as text unless a shell reads it, so writing a file that mentions a risky command is no longer blocked. A `<<` in arithmetic is a shift, not a here-document.
- The red alert banner sits at its own height and fits its text.
- The service record only counts up, and an acknowledged briefing stays gone after a reload.
- Console drawings fit a narrow pane, and a full deck of crew is never cut off.

## 0.4.7
- Shields judges each line of a multi-line command on its own.

## 0.4.6
- Shields judges here-document bodies again.

## 0.4.5
- Shields closes more gaps.

## 0.4.4
- Privacy disclosure, AI summaries opt-out, shared band.

## 0.4.3
- Pre-sale fixes.
