import type { EngineInterface, On } from 'claude-code'

import { HEAD_COLOR, LCARS } from './theme'

// The About pane: every part of the mod in the order the console shows it, what it does, and
// what it talks to outside this chat. Keep it matched to console.tsx when the console changes

export const ABOUT_PANE = 'starfleet-about'

type Part = { name: string; keys?: string; what: string[]; links: string }
type Group = { title: string; parts: Part[] }

const LOCAL = 'Nothing outside Claude Code.'

const GROUPS: Group[] = [
  { title: 'ON THE CONSOLE, TOP TO BOTTOM', parts: [
    { name: 'Viewscreen', keys: '◀ ▶',
      what: ['The ship orbiting a planet picked for this project. The arrows swap the planet.'],
      links: LOCAL },
    { name: 'Stardate and condition',
      what: [
        "Today's date as month and day, then the year (1027.26). Condition sits under it: green when all's well, yellow once this chat's memory is half full, Borg at 70%, and red during a red alert.",
        'Course tracks the work: holding orbit, surveying (Claude is reading files), under way (files changed), mission advancing (tests passed), landing party ashore (committed). The line under it counts files changed, test passes and commits, and says when the last check (a test or build) passed or failed. Hull breach means the last check failed.',
        'Time log is how long the chat has been open and how long Claude has been working. Orders counts the tools Claude has used in this chat.',
      ],
      links: LOCAL },
    { name: 'Admin buttons',
      what: ["Captain mode (c) has Claude answer as the ship's computer. Focus (f) shrinks the console to the comms badge. Red alert (r) sounds the klaxon. Mute (o) turns sounds off. Close mission (z) is below. About (a) is this page."],
      links: LOCAL },
    { name: "Captain's log",
      what: ['The gold block. Type a note and press Record. It saves here and goes to your hub right away.'],
      links: 'Your Starfleet Command hub.' },
    { name: 'Last order',
      what: ['A short title for your latest prompt, so you can see what Claude is working on.'],
      links: 'Claude Haiku writes the title for prompts over 48 characters. /ai-summaries off stops it.' },
    { name: 'Mission briefing', keys: 'b',
      what: ['A quick catch-up from your recent log notes and newest handoff. Acknowledged (k) clears it.'],
      links: 'Claude Haiku, through your own account. /ai-summaries off stops it.' },
    { name: 'Crew decks',
      what: [
        "The grey section. Each project you've chatted in gets a crew member for good. They stand on the bridge if the project was active today, in engineering with uncommitted changes, in sickbay when tests fail, and in quarters when it's idle.",
        "+ Add project and − Remove project change who's aboard. Rescan + sync crew (n) refreshes them and updates the hub.",
      ],
      links: "git status in each project folder, gh for cloud repos you pick, the app's chat list (for archived chats and the emoji on chat titles), your other open chats, and your hub." },
    { name: 'Main engineering (the warp core)',
      what: [
        "Core load is how full this chat's memory is. Dilithium is the same thing in tokens. Condition warns at 50%, 70% and 85%. Warp drive shows when Claude is working.",
        'Eject core (e, press twice) has Claude write a handoff and carry on in a new chat. Compact memory (m) shows up at 70% and shrinks the chat history to free room. At 70% and 85% the core asks once whether you are still mid-task: mid-task recommends Compact, done recommends Eject core.',
      ],
      links: 'Handoffs are saved in .claude/handoffs in your project.' },
    { name: 'Service record',
      what: ['Your rank goes up with the prompts you send. Missions counts prompts, tours counts chats, deflected counts commands the shields stopped, and scans counts sensor scans.'],
      links: LOCAL },
  ] },
  { title: 'WORKING IN THE BACKGROUND', parts: [
    { name: 'Close mission', keys: 'z',
      what: ['Files a closure report and sends your missions, log and crew to the hub, so the chat is safe to archive. Your first one sets up the hub.'],
      links: 'Your Starfleet Command hub.' },
    { name: 'Starfleet Command hub', keys: '/hub',
      what: ['A claude.ai page with your notes, log, crew and mission history. Only you can open it unless you share it.'],
      links: 'claude.ai.' },
    { name: 'Shields',
      what: ["Stops Claude from running common destructive commands by mistake, like force pushes, hard resets and recursive deletes. It's a seatbelt, not a sandbox."],
      links: 'Nothing. It checks each command before it runs.' },
    { name: 'Make it so',
      what: ["When Claude ends on a question, press it to approve just the one step Claude proposed. It's never offered for deletes, resets, force pushes, deploys or merges."],
      links: 'Nothing. Your reply shows exactly what Claude is told.' },
  ] },
  { title: 'TYPE THESE IN THE CHAT BOX', parts: [
    { name: '/translator',
      what: ['Translates a phrase into a Star Trek language.'],
      links: 'Claude Haiku, only when you use it.' },
    { name: '/bridge, /starship, /log, /crew, /warp-core',
      what: ["The live bridge shows what Claude is doing right now. Starship shows the ship. The rest open one console section on its own."],
      links: LOCAL },
  ] },
]

export function registerAbout(on: On) {
  on('ui.render', { component: 'Pane', requestId: ABOUT_PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" rowGap={1} padding="sm">
        <Text backgroundColor={HEAD_COLOR} color={LCARS.ink} bold> ABOUT STARFLEET </Text>
        <Text>Starfleet turns each Claude Code chat into a starship mission. Here's what each part does, and what it connects to (↔).</Text>
        {GROUPS.map(g => (
          <Box key={g.title} flexDirection="column" rowGap={1}>
            <Text backgroundColor={HEAD_COLOR} color={LCARS.ink} bold> {g.title} </Text>
            {g.parts.map(p => (
              <Box key={p.name} flexDirection="column">
                <Text><Text bold>{p.name}</Text>{p.keys && <Text dimColor>  {p.keys}</Text>}</Text>
                {p.what.map(line => <Text>{line}</Text>)}
                <Text dimColor>↔ {p.links}</Text>
              </Box>
            ))}
          </Box>
        ))}
        <Text dimColor>Everything else stays in Claude Code's storage on your computer.</Text>
        <Button key="about-close" label="Close" plain onPress={() => { void $.ui.close({ id: ABOUT_PANE }).catch(() => {}) }} />
      </Box>
    )
  })
}

export async function openAbout($: EngineInterface) {
  const opened = await $.ui.open({ id: ABOUT_PANE, title: 'ℹ️ About Starfleet', focus: true, closeOnEscape: true })
  if (!opened.isPlaced) $.ui.toast(`About not shown: ${opened.reason}`)
}
