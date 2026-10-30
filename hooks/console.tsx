import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, RenderElement } from 'claude-code'

import { buildBriefing, currentBriefing, dismissBriefing } from './briefing'
import { TIER_TEXT, coreFlags, coreSvg, ejectCore, tierOf } from './core'
import { openAbout } from './about'
import { DECKS, DECK_H, crewNow, crewSvg, openManageCrew, scanCrew } from './crew'
import { hubUrl, isSettingUpHub, loadLogDraft, openLog, readLog, sendClosure, setUpHub } from './log'
import { isAiOn, setAi, isBandOn, setBand } from './prefs'
import { redAlertSvg, toggleRedAlert } from './ops'
import { BADGE_H, BADGE_W, RANKS, SPRITES, SPRITE_COLORS, basename, pipsSvg, rankBadgeSvg, rankOf, stardate } from './shared'
import { COURSE, courseOf, duration, readVoyage, updateVoyage } from './voyage'
import { LCARS, PLANETS, chirp, commsBadgeSvg, isMuted, lcarsCode, lcarsFrameSvg, planetOf, stillSvg, viewscreenSvg } from './theme'

// The Starfleet console: viewscreen, mission briefing, then each station in a collapsible
// LCARS section. Which sections are open is kept across sessions, and so is focus mode,
// where the console shows only the comms badge until it is tapped.

const CONSOLE_PANE = 'starfleet-console'

const isCaptainMode = atom({ plugin: 'starfleet', key: 'isCaptainMode' } as const, false)
const record = atom({ plugin: 'starfleet', key: 'record' } as const, { sessions: 0, turns: 0, blocked: 0, scans: 0 })
const activity = atom({ plugin: 'starfleet', key: 'activity' } as const, { current: null, turnStartedAt: null, turnCalls: 0, recent: [] })
const redAlert = atom({ plugin: 'starfleet', key: 'redAlert' } as const, { isOn: false, reason: '' })
const assimilation = atom({ plugin: 'starfleet', key: 'assimilation' } as const, 0)

type Section = 'crew' | 'core' | 'record'
type SectionSpec = { id: Section; label: string }
const CREW: SectionSpec = { id: 'crew', label: 'CREW DECKS' }
const CORE: SectionSpec = { id: 'core', label: 'MAIN ENGINEERING' }
const RECORD: SectionSpec = { id: 'record', label: 'SERVICE RECORD' }

// Module state: open sections (loaded from $.store), and whether the sound toggle is muted
let open: Record<Section, boolean> = { crew: true, core: true, record: false }
let isOpenLoaded = false
let muted = false
let isFocus = false
// Whether the focus-mode badge holds still, kept in the store so it stays paused across reloads
let isBadgePaused = false
// Block outlines rotate through the brand colors in this order
// The captain's log is always gold and the crew decks always grey; the other blocks rotate
// through the rest, so a block never borrows those two colors
const PINNED_OUTLINES: Record<string, string> = { 'b-log': LCARS.gold, 'box-crew': LCARS.dim }
const OUTLINES = [LCARS.violet, LCARS.lilac, LCARS.red] as const

// The chat id the voyage was loaded for: /clear keeps the process but changes the id
let chatLoadedFor: string | undefined

async function loadPrefs($: EngineInterface) {
  await loadChat($)
  if (isOpenLoaded) return
  const saved = (await $.store.get('consoleOpen')) as Partial<Record<Section, boolean>> | undefined
  if (saved) open = { ...open, ...saved }
  muted = await isMuted($)
  isFocus = (await $.store.get('focusMode')) === true
  isBadgePaused = (await $.store.get('badgePaused')) === true
  isOpenLoaded = true
}

// What belongs to one chat: its Captain's log draft (kept by the log tab) and its voyage start.
// Loaded again whenever the chat id changes, so a /clear starts clean
async function loadChat($: EngineInterface) {
  await loadLogDraft($)
  const id = await $.session.id()
  if (chatLoadedFor === id) return
  const isNewChat = chatLoadedFor !== undefined
  chatLoadedFor = id
  if (isNewChat) await updateVoyage($, v => v)
}

async function toggle($: EngineInterface, id: Section) {
  void chirp($)
  open = { ...open, [id]: !open[id] }
  await $.store.set('consoleOpen', open)
  if (id === 'crew' && open.crew && (await crewNow($)).length === 0) await scanCrew($)
  $.ui.invalidate('ui.render')
}

async function setFocus($: EngineInterface, value: boolean) {
  isFocus = value
  await $.store.set('focusMode', value)
  if (!value && open.crew && (await crewNow($)).length === 0) void scanCrew($).then(() => $.ui.invalidate('ui.render'), () => {})
  $.ui.invalidate('ui.render')
}

// The planet each project orbits, kept across sessions; unset is the project's own Uncharted world
async function planetFor($: EngineInterface, project: string): Promise<string | undefined> {
  return (await $.store.get(`planet:${project}`)) as string | undefined
}

async function cyclePlanet($: EngineInterface, project: string, step: 1 | -1) {
  void chirp($)
  const i = PLANETS.indexOf(planetOf(await planetFor($, project)))
  const next = PLANETS[(i + step + PLANETS.length) % PLANETS.length]!
  await $.store.set(`planet:${project}`, next.id)
  $.ui.invalidate('ui.render')
}

// Every press chirps first
async function pressed($: EngineInterface, run: () => unknown) {
  void chirp($)
  await run()
}

// Split a list into rows of n, for a grid of buttons
function chunk<T>(items: T[], n: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / n) }, (_, i) => items.slice(i * n, i * n + n))
}

function meter(percent: number, width = 10): string {
  const filled = Math.round((percent / 100) * width)
  return '▰'.repeat(filled) + '▱'.repeat(width - filled)
}

export async function consoleSessionStart($: EngineInterface) {
  // Each command registers on its own: another mod holding one name (baseplate has /hub and
  // /ai-summaries) must never stop the rest, /starfleet above all
  await $.command.register({ name: 'band', description: 'The strip above the prompt: /band off hides it, /band on shows it', immediate: true, argumentHint: 'on | off' }).catch(() => {})
  await $.command.register({ name: 'ai-summaries', description: 'Starfleet AI summaries: /ai-summaries off stops sending prompts and log notes to Haiku for titles and briefings; on turns them back on', immediate: true, argumentHint: 'on | off' }).catch(() => {})
  await $.command.register({ name: 'starfleet', description: 'Open the Starfleet console: viewscreen, briefing, crew decks, captain’s log, main engineering, service record. /starfleet focus shows only the comms badge', immediate: true }).catch(() => {})
  // Open the console unasked, without focus; narrow terminals hold it until /starfleet.
  // The crew scan runs behind it; the briefing (a model call) waits until asked for
  await loadPrefs($)
  // Stamp the voyage's start the first time this session opens the console
  await updateVoyage($, v => v)
  await $.ui.open({ id: CONSOLE_PANE, title: '🖖 Starfleet', closeOnEscape: true })
  if (open.crew && !isFocus) void scanCrew($).then(() => $.ui.invalidate('ui.render'), () => {})
}

// The captain's last order, kept per session so a reload or reopen still shows it
type LastOrder = { text: string; at: number; summary?: string }
async function lastOrderKey($: EngineInterface) {
  return `lastPrompt:${await $.session.id()}`
}

// Called from register.tsx's prompt.submit hook (an event takes one unmatched hook per module)
export async function rememberOrder($: EngineInterface, e: { text: string; command?: unknown; isMeta?: boolean }) {
  const text = e.text.trim()
  if (e.command || e.isMeta || !text) return
  const key = await lastOrderKey($)
  // A short one-line ask stands as its own summary; anything longer is summed up by a model
  const isShort = text.length <= 48 && !text.includes('\n') && !text.includes('`')
  // Only the start is kept: the pane shows a line of it, and a pasted log must not fill the store
  const ai = isShort || (await isAiOn($))
  await $.store.set(key, { text: text.slice(0, 2000), at: await $.clock.now(), summary: isShort ? text : ai ? undefined : gist(text) } satisfies LastOrder)
  $.ui.invalidate('ui.render')
  if (!isShort && (await isAiOn($))) void summarizeOrder($, key, text).catch(() => {})
}

const ORDER_SYSTEM = `Turn the user's request into a punchy starship order: imperative, 3 to 7 words, no period.
Name the goal only, never code, files' contents, logs or pasted text. No preamble, no quotes.
Examples: "Fix the login crash" · "Add dark mode to settings" · "Shrink the condition badge"`

async function summarizeOrder($: EngineInterface, key: string, text: string) {
  const reply = await $.model.complete({ model: 'haiku', system: ORDER_SYSTEM, prompt: text.slice(0, 6000), maxTokens: 30 })
  const summary = reply.isAnswered && reply.text.trim() ? reply.text.trim().split('\n')[0]!.replace(/^["“]|["”.]$/g, '') : gist(text)
  const saved = (await $.store.get(key)) as LastOrder | undefined
  // A newer prompt may have landed while this one was being summed up
  if (saved?.text !== text) return
  await $.store.set(key, { ...saved, summary })
  $.ui.invalidate('ui.render')
}

// The first line of prose, code blocks and inline code dropped: shown until (or if no) summary
function gist(text: string): string {
  const prose = text.replace(/```[\s\S]*?(```|$)/g, ' ').replace(/`[^`]*`/g, '…').split('\n').map(l => l.trim()).find(Boolean) ?? ''
  return prose.length > 60 ? prose.slice(0, 59) + '…' : prose || 'Pasted material'
}

export function registerConsole(on: On) {
  on('command.run', { command: 'band' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'on' || arg === 'off') await setBand($, arg === 'on')
    else if (arg) return { text: 'Use /band on or /band off.' }
    return { text: (await isBandOn($)) ? 'Band on: the strip above the prompt shows the ship while Claude works, red alert and warp core warnings. /band off hides it.' : 'Band off: nothing is drawn above the prompt. The console and warp core pane still show the warnings. /band on brings it back.' }
  })
  on('command.run', { command: 'ai-summaries' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'on' || arg === 'off') await setAi($, arg === 'on')
    else if (arg) return { text: 'Use /ai-summaries on or /ai-summaries off.' }
    return {
      text: (await isAiOn($))
        ? 'AI summaries on: long prompts get a short title, and the mission briefing is written from your notes, by Haiku. /ai-summaries off stops it.'
        : 'AI summaries off: nothing is sent to a model for titles or briefings. /ai-summaries on turns them back on.',
    }
  })

  on('command.run', { command: 'starfleet' }, async ($, e) => {
    await loadPrefs($)
    if (e.args.trim() === 'focus') {
      await setFocus($, true)
      const opened = await $.ui.open({ id: CONSOLE_PANE, title: '🖖 Starfleet', focus: true, closeOnEscape: true })
      return opened.isPlaced ? {} : { text: `Console offline: ${opened.reason}` }
    }
    if (isFocus) await setFocus($, false)
    if (open.crew && (await crewNow($)).length === 0) await scanCrew($)
    const opened = await $.ui.open({ id: CONSOLE_PANE, title: '🖖 Starfleet', focus: true, closeOnEscape: true })
    void chirp($)
    await buildBriefing($)
    return opened.isPlaced ? {} : { text: `Console offline: ${opened.reason}` }
  })

  on('ui.render', { component: 'Pane', requestId: CONSOLE_PANE }, async ($, e) => {
    await loadPrefs($)
    const el = $.ui.resolve(e)
    const { Box, Text, Button } = el
    const hasSvg = 'Svg' in el

    // ── Focus mode: the comms badge alone; tapping it opens the full console ──
    if (isFocus) {
      return (
        // The badge, then Hail Starfleet, then Pause or Play, one under the other and all centered.
        // A picture can't take a click, so Pause is a button; hovering also stills the badge a moment
        <Box flexDirection="column" rowGap={1} padding="sm" alignItems="center">
          {hasSvg
            ? <el.Svg source={commsBadgeSvg(isBadgePaused)} alt={isBadgePaused ? 'Starfleet comms badge, paused' : 'Starfleet comms badge, chirping'} isInteractive />
            : <Text color={LCARS.gold} bold>{'   ▲\n  ◢█◣\n ◥▀ ▀◤'}</Text>}
          <Box flexDirection="row" justifyContent="center" width="100%">
            <Button key="hail" label="🖖 Hail Starfleet" variant="primary" onPress={() => pressed($, () => setFocus($, false))} />
          </Box>
          {hasSvg && (
            <Box flexDirection="row" justifyContent="center" width="100%">
              <Button key="pause" label={isBadgePaused ? '▶ Play' : '⏸ Pause'} plain onPress={() => pressed($, async () => {
                isBadgePaused = !isBadgePaused
                await $.store.set('badgePaused', isBadgePaused)
                $.ui.invalidate('ui.render')
              })} />
            </Box>
          )}
        </Box>
      )
    }
    const now = await $.clock.now()
    // While the console holds the keyboard (after any click in it) every wheel tick redraws it, and
    // an animated picture then shivers the scroll (see stillSvg): the pictures hold still until Esc
    const isHeld = e.props.isFocused === true
    const pic = (svg: string) => (isHeld ? stillSvg(svg) : svg)
    // The width drawings are laid out at; each Svg carries no size of its own, so the surface
    // scales it down to fit the pane (height follows) whenever the pane is narrower
    const width = Math.max(240, Math.min(560, ((e.props.bodyColumns ?? 50) - 4) * 8))
    // A narrow pane gets a 2-column button grid and section headers without their access codes
    const isNarrow = (e.props.bodyColumns ?? 50) < 60
    const a = await read($, activity)
    const alert = await read($, redAlert)
    const percent = await read($, assimilation)
    const tier = tierOf(percent)
    const captain = await read($, isCaptainMode)
    const bandOn = await isBandOn($)
    const project = basename(await $.session.cwd())
    const seconds = a.turnStartedAt === null ? null : Math.floor((now - a.turnStartedAt) / 1000)
    const condition = alert.isOn
      ? { label: 'RED', color: LCARS.red }
      // Borg gets orange, a step up from yellow, so a full memory never reads as all-clear green
      : tier >= 2 ? { label: 'BORG', color: LCARS.orange }
      : tier === 1 ? { label: 'YELLOW', color: LCARS.gold }
      : { label: 'GREEN', color: LCARS.green }
    const voyage = await readVoyage($)
    const course = courseOf(voyage, now)
    const warpMs = voyage.warpMs + (seconds ?? 0) * 1000

    // Every block gets an outline: the log and crew keep their pinned colors, the rest rotate violet,
    // lilac, red down the console. Each block's color is settled up front (blocks that aren't shown
    // are skipped), so its heading swatch can match its outline
    const order = (await $.store.get(await lastOrderKey($))) as LastOrder | undefined
    const b = await currentBriefing($)
    const shown = ['b-view', 'b-status', 'b-log', order && 'b-order', !b.isDismissed && 'b-brief', 'box-crew', 'box-core', 'box-record'].filter(Boolean) as string[]
    const rotating = shown.filter(key => !PINNED_OUTLINES[key])
    const outlineOf = (key: string) => PINNED_OUTLINES[key] ?? OUTLINES[Math.max(0, rotating.indexOf(key)) % OUTLINES.length]!
    const block = (key: string, children: RenderElement | (RenderElement | false | null | undefined)[]) => (
      <Box key={key} flexDirection="column" rowGap={1} borderStyle="round" borderColor={outlineOf(key)} paddingX={1}>{children}</Box>
    )

    // Every block's heading looks the same: a swatch in its block's outline color, the name in
    // bold, a dim summary after it
    const head = (label: string, summary: string | undefined, block: string) => (
      <Box flexDirection="row" columnGap={1} alignItems="center" flexWrap="wrap">
        <Text backgroundColor={outlineOf(block)} color={LCARS.ink}>{'  '}</Text>
        <Text bold>{label}</Text>
        {summary && <Text dimColor>{summary}</Text>}
      </Box>
    )

    // An LCARS section: a colored pill, the header button, its access code and a summary
    const section = (s: SectionSpec, summary: string, body: () => RenderElement) => (
      <Box key={'box-' + s.id} flexDirection="column" rowGap={open[s.id] ? 1 : 0} borderStyle="round" borderColor={outlineOf('box-' + s.id)} paddingX={1}>
        {/* The same heading as every block (swatch, bold name, details after it), with the open and
            close arrow at the far right */}
        <Box flexDirection="row" columnGap={1} alignItems="center" justifyContent="space-between">
          {head(s.label, [isNarrow ? '' : lcarsCode(s.label), summary].filter(Boolean).join(' · '), 'box-' + s.id)}
          <Button key={'sec-' + s.id} label={open[s.id] ? '▾' : '▸'} plain dimColor onPress={() => toggle($, s.id)} />
        </Box>
        {open[s.id] && body()}
      </Box>
    )

    // ── Frame and viewscreen ──
    const frame = hasSvg
      ? <Box width="100%"><el.Svg source={lcarsFrameSvg(560, 'USS CLAUDE', lcarsCode(project), alert.isOn ? LCARS.red : LCARS.orange)} alt="USS Claude LCARS console" /></Box>
      : <Text backgroundColor={alert.isOn ? LCARS.red : LCARS.orange} color={LCARS.ink} bold> USS CLAUDE · LCARS {lcarsCode(project)} </Text>
    const tint = alert.isOn ? 'red' : tier >= 2 ? 'borg' : 'none'
    // Arrows either side of the viewscreen swap the planet
    const planet = planetOf(await planetFor($, project))
    // The default planet takes this project's crew color, the same as its chats' tag
    const here = (await crewNow($)).find(c => c.isCurrent)
    const crewColor = here ? SPRITE_COLORS[here.sprite] : undefined
    const viewscreen = (
      <Box flexDirection="row" columnGap={1} alignItems="center">
        <Button key="planet-prev" label="◀" plain dimColor onPress={() => cyclePlanet($, project, -1)} />
        {/* The screen takes what the arrows leave and shrinks with the pane; the arrows never get pushed
            out. A plain image (not interactive) fills that space; its CSS orbit animation still runs */}
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          {hasSvg
            ? <el.Svg source={pic(viewscreenSvg(project, tint, planet.id, crewColor, isHeld ? undefined : now))} alt={`Viewscreen: the ship in standard orbit around ${project}, a ${planet.name} planet`} />
            : <Text color={LCARS.blue} wrap="truncate">{`   ·   ✦     (◯) ${planet.name}   >=<    ·   ✦  `}</Text>}
        </Box>
        <Button key="planet-next" label="▶" plain dimColor onPress={() => cyclePlanet($, project, 1)} />
      </Box>
    )

    // ── Status and controls ──
    const adminButtons = [
      <Button key="captain" label={captain ? '🖖 Captain mode: on' : 'Captain mode: off'} hotkey="c" plain onPress={() => pressed($, () => update($, isCaptainMode, v => !v))} />,
      <Button key="focus" label="Focus" hotkey="f" plain onPress={() => pressed($, () => setFocus($, true))} />,
      <Button key="alert" label={alert.isOn ? 'Stand down' : 'Red alert'} hotkey="r" plain onPress={() => toggleRedAlert($)} />,
      <Button key="sound" label={muted ? 'Unmute' : 'Mute'} hotkey="o" plain dimColor={muted} onPress={async () => {
        muted = !muted
        await $.store.set('muted', muted)
        if (!muted) void chirp($)
        $.ui.invalidate('ui.render')
      }} />,
      <Button key="band" label={bandOn ? 'Band: on' : 'Band: off'} hotkey="h" plain dimColor={!bandOn} onPress={() => pressed($, () => setBand($, !bandOn))} />,
      <Button key="closure" label="Close mission" hotkey="z" plain onPress={() => pressed($, () => sendClosure($))} />,
      <Button key="about" label="About" hotkey="a" plain onPress={() => pressed($, () => openAbout($))} />,
    ]
    const status = (
      <Box flexDirection="column" rowGap={1}>
        {alert.isOn && hasSvg && <el.Svg source={redAlertSvg(alert.reason, width)} alt={`Red alert: ${alert.reason}`} height={34} isInteractive />}
        {/* Condition sits on its own line under the stardate, so the header never wraps around it */}
        <Box flexDirection="column" alignItems="flex-start">
          <Text color={LCARS.peach} size="title" weight="bold" tabular>STARDATE {stardate(now)}</Text>
          <Text backgroundColor={condition.color} color={LCARS.ink} size="caption" bold> CONDITION {condition.label} </Text>
        </Box>
        <Box flexDirection="column">
          {/* One line, cut if long: the stage name grows as the work moves on, mid-turn included */}
          <Text wrap="truncate">
            <Text color={LCARS.violet} bold>{'COURSE'.padEnd(11)}</Text>
            <Text color={course.isBreach ? LCARS.red : LCARS.green}>{meter((course.stage / (COURSE.length - 1)) * 100, COURSE.length - 1)} </Text>
            <Text color={course.isBreach ? LCARS.red : course.stage ? LCARS.gold : LCARS.dim} bold>{course.label}</Text>
          </Text>
          {/* One line, cut if long: it grows while Claude works and must not change the block's height */}
          <Text dimColor wrap="truncate">{' '.repeat(11)}{course.detail}</Text>
          {/* These tick every second while Claude works: one line each, cut if long, so the block
              never changes height mid-turn */}
          <Text wrap="truncate">
            <Text color={LCARS.violet} bold>{'TIME LOG'.padEnd(11)}</Text>
            <Text tabular>on duty {duration(now - voyage.startedAt)} · at warp {duration(warpMs)}</Text>
          </Text>
          <Text wrap="truncate">
            <Text color={LCARS.violet} bold>{'TOOLS USED'.padEnd(11)}</Text>
            <Text tabular>{voyage.orders + a.turnCalls}</Text>
          </Text>
        </Box>
        {/* Admin controls on an invisible grid, so they line up: 3 columns, 2 on a narrow pane */}
        <Box flexDirection="column" rowGap={0}>
          {chunk(adminButtons, isNarrow ? 2 : 3).map((row, r) => (
            <Box key={'admin-' + r} flexDirection="row">
              {row.map((b, c) => <Box key={`cell-${r}-${c}`} width={isNarrow ? '50%' : '33%'}>{b}</Box>)}
            </Box>
          ))}
        </Box>
      </Box>
    )

    // ── Last order: a toast-style card with the captain's latest prompt ──
    const lastOrder = order && (
      <Box flexDirection="column">
        {head('LAST ORDER', `${duration(now - order.at)} ago`, 'b-order')}
        {/* One line, cut if long: the short title arrives mid-turn and must not change the height */}
        <Text wrap="truncate">{order.summary ?? gist(order.text)}</Text>
      </Box>
    )

    // ── Mission briefing ──
    const briefing = b.isDismissed ? null : b.status === 'none' ? (
      <Box flexDirection="column" rowGap={1}>
        {head('MISSION BRIEFING', 'where this project left off', 'b-brief')}
        <Button key="brief" label="Get briefing" hotkey="b" plain onPress={() => pressed($, () => buildBriefing($))} />
      </Box>
    ) : (
      <Box flexDirection="column">
        {head('MISSION BRIEFING', b.status === 'loading' ? 'Decoding transmission…' : `from ${b.source}`, 'b-brief')}
        {b.lines.map(line => {
          const [head, ...rest] = line.split(':')
          return rest.length && /^[A-Z ]+$/.test(head!)
            ? <Text><Text color={LCARS.violet}>{head}:</Text>{rest.join(':')}</Text>
            : <Text>{line}</Text>
        })}
        {b.status === 'ready' && <Button key="ack" label="Acknowledged" hotkey="k" plain dimColor onPress={() => pressed($, async () => { await dismissBriefing($); $.ui.invalidate('ui.render') })} />}
      </Box>
    )

    // ── Crew decks ──
    const crew = await crewNow($)
    // Built only while the section is open: the console redraws every second during a turn
    const crewBody = () => (
      <Box flexDirection="column" rowGap={1}>
        {crew.length === 0 && <Text dimColor>Scanning for crew…</Text>}
        {crew.length > 0 && hasSvg && (
          // A plain image (not interactive) takes the full width of its box; its CSS walk and bob
          // animations still run inside it
          <Box width="100%">
            <el.Svg source={pic(crewSvg(crew, now))} alt={crew.map(c => `${c.name} (${c.project}) on ${c.deck}`).join(', ')} />
          </Box>
        )}
        {!hasSvg && crew.map(c => (
          <Text>
            {SPRITES[c.sprite]?.emoji ?? '  '} <Text color={LCARS.peach} bold>{c.name.padEnd(8)}</Text> {c.project.padEnd(16)} <Text color={LCARS.lilac}>{c.deck.toUpperCase()}</Text>
          </Text>
        ))}
        {/* Every crew action (rescan, add, remove, characters) happens in its own short tab: a button
            pressed here gives the console focus, and the app then pulls the pane to the bottom
            whenever the press redraws the decks */}
        <Button key="manage-crew" label="Manage crew" hotkey="w" plain onPress={() => pressed($, () => openManageCrew($))} />
      </Box>
    )

    // ── Captain's log: a button to the log tab, the one place entries are listed. The field
    // lives in that tab: a field here gives the console the keys, and the app then fights every
    // scroll (the focus shiver) ──
    const log = await readLog($)
    // With no hub yet, a button to set one up now, so a new captain doesn't have to find Close mission
    const hasHub = (await hubUrl($)) !== undefined
    const isSettingUp = !hasHub && (await isSettingUpHub($))
    const logButton = (
      <Box flexDirection="column" rowGap={1}>
        {head('CAPTAIN’S LOG', log.length ? `${log.length} entries` : '', 'b-log')}
        <Box flexDirection="column" alignItems="flex-start" rowGap={1}>
          {/* The app's own filled button, in its colors: the desktop draws mod buttons natively and
              ignores a text color set on them, so black text on a lilac pill never showed */}
          <Button key="open-log" label="Captain’s log" variant="primary" onPress={() => pressed($, () => openLog($))} />
          <Text dimColor>or type /log and a note in the prompt box</Text>
          {!hasHub && <Button key="setup-hub" label={isSettingUp ? 'Setting up your hub…' : 'Set up my hub'} plain onPress={() => pressed($, () => setUpHub($))} />}
          {!hasHub && <Text dimColor>Your own private claude.ai page for notes, crew and missions</Text>}
        </Box>
      </Box>
    )

    // ── Main engineering: the warp core, laid out as labeled readouts ──
    const flags = coreFlags(now)
    // Claude Code reports the window; working it out from a rounded percent is only the fallback
    const window = flags.window || (flags.tokens && percent ? Math.round(flags.tokens / (percent / 100)) : 0)
    // Labels padded to the longest (WARP DRIVE) and one space, so values line up without wasting width
    const readout = (label: string, value: RenderElement | string, color?: string) => (
      <Text wrap="truncate"><Text color={LCARS.violet} bold>{label.padEnd(11)}</Text><Text color={color}>{value}</Text></Text>
    )
    const stacked = (label: string, value: string, color?: string) => (
      <Box flexDirection="column">
        <Text color={LCARS.violet} bold>{label}</Text>
        <Text color={color} wrap="truncate">{value}</Text>
      </Box>
    )
    // Two columns at every width: the warp core on the left, never shrunk, and its readouts and
    // buttons on the right, taking the rest. The note runs full width under both, so the right
    // column stays about the core's height and the two balance
    const coreBody = () => (
      <Box flexDirection="column" rowGap={1}>
      <Box flexDirection="row" columnGap={2}>
        {/* The core with its Eject button under it, at the column's right edge */}
        <Box flexShrink={0} flexDirection="column" rowGap={1}>
          {hasSvg
            ? <el.Svg source={pic(coreSvg(percent, seconds !== null, flags.isEjecting))} alt={`Warp core at ${percent}% load`} width={80} height={200} isInteractive />
            : <Text color={LCARS.blue}>{'▮\n'.repeat(7)}</Text>}
          <Box flexDirection="row" justifyContent="flex-end" width="100%">
            <Button key="eject" label={flags.isArmed ? 'Confirm eject' : 'Eject core'} hotkey="e" plain onPress={() => pressed($, () => ejectCore($))} />
          </Box>
        </Box>
        <Box flexDirection="column" rowGap={1} flexShrink={1} minWidth={0}>
          {/* Each label above its value, so a value gets the full width instead of being cut beside
              its label. Every value is one line, so the block keeps its height mid-turn */}
          <Box flexDirection="column" rowGap={1}>
            {stacked('CORE LOAD', `${percent}%  ${meter(percent)}`, tier >= 2 ? LCARS.green : LCARS.text)}
            {stacked('DILITHIUM', flags.tokens ? `${Math.round(flags.tokens / 1000)}k of ${Math.round(window / 1000)}k tokens` : 'Reading…')}
            {stacked('CONDITION', tier ? TIER_TEXT[tier]! : 'Nominal', tier ? LCARS.green : LCARS.text)}
            {stacked('WARP DRIVE', seconds === null ? 'Standing by' : `Engaged · ${seconds}s`, seconds === null ? LCARS.dim : LCARS.gold)}
          </Box>
          {flags.isEjecting && <Text color={LCARS.red} bold>CORE EJECTED · writing the handoff</Text>}
          {tier >= 2 && <Box flexDirection="row"><Button key="compact" label="Compact memory" hotkey="m" onPress={() => pressed($, () => $.session.compact())} /></Box>}
        </Box>
      </Box>
      <Text dimColor italic>Eject writes a handoff and continues in a new chat. The project stays open.</Text>
      </Box>
    )

    // ── Service record ──
    const r = await read($, record)
    const rank = rankOf(r.turns)
    const nextRank = RANKS.find(x => x.at > r.turns)
    const recordBody = () => (
      <Box flexDirection="column" rowGap={1}>
        {/* The pips and rank badge on one line (the badge drops under the pips when narrow), how
            far to the next rank on its own line under them */}
        <Box flexDirection="column">
          <Box flexDirection="row" columnGap={2} rowGap={1} flexWrap="wrap" alignItems="center">
            {hasSvg
              ? <el.Svg source={pipsSvg(rank.pips)} alt={`${rank.pips} rank pips`} width={rank.pips * 26 + 18} height={40} />
              : <Text color={LCARS.gold}>{'●'.repeat(rank.pips)}</Text>}
            {hasSvg
              ? <el.Svg source={rankBadgeSvg(rank)} alt={`${rank.name} rank badge`} width={BADGE_W} height={BADGE_H} />
              : <Text bold>{rank.name}</Text>}
          </Box>
          <Text dimColor>{nextRank ? `${nextRank.at - r.turns} prompts to ${nextRank.name}` : 'Flag rank achieved'}</Text>
        </Box>
        {/* Two columns: what you did (prompts, tours) on the left, what the ship did (deflected,
            scans) on the right */}
        <Box flexDirection="row" columnGap={2}>
          <Box flexDirection="column" width="50%" flexShrink={1} minWidth={0}>
            {readout('PROMPTS', String(r.turns))}
            {readout('TOURS', String(r.sessions))}
          </Box>
          <Box flexDirection="column" width="50%" flexShrink={1} minWidth={0}>
            {readout('DEFLECTED', String(r.blocked))}
            {readout('SCANS', String(r.scans))}
          </Box>
        </Box>
      </Box>
    )

    const tree = (
      <Box flexDirection="column" rowGap={1} padding="sm">
        {frame}
        {block('b-view', viewscreen)}
        {block('b-status', status)}
        {/* The captain's log sits right under the stardate, then the last order and the briefing; the
            numbered sections (1 to 3) come together below */}
        {block('b-log', logButton)}
        {lastOrder && block('b-order', lastOrder)}
        {briefing && block('b-brief', briefing)}
        {section(CREW, crew.length ? `${crew.length} aboard` : 'Not scanned', crewBody)}
        {section(CORE, tier ? TIER_TEXT[tier]! : `Core load ${percent}%`, coreBody)}
        {section(RECORD, `${rank.name} · ${r.turns} prompts`, recordBody)}
      </Box>
    )
    return tree
  })
}
