import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, RenderElement } from 'claude-code'

import { buildBriefing, currentBriefing, dismissBriefing } from './briefing'
import { TIER_TEXT, coreFlags, coreSvg, ejectCore, tierOf } from './core'
import { DECKS, DECK_H, crewNow, crewSvg, scanCrew } from './crew'
import { LOG_FILES, addLogEntry, crewSyncPrompt, filed, readLog, saveMarkdown, sendClosure, syncPrompt } from './log'
import { redAlertSvg, toggleRedAlert } from './ops'
import { RANKS, basename, pipsSvg, rankOf, stardate } from './shared'
import { COURSE, courseOf, duration, readVoyage, updateVoyage } from './voyage'
import { LCARS, PLANETS, chirp, commsBadgeSvg, isMuted, lcarsCode, lcarsFrameSvg, planetOf, viewscreenSvg } from './theme'

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
type SectionSpec = { id: Section; label: string; hotkey: string; color: string }
const CREW: SectionSpec = { id: 'crew', label: 'CREW DECKS', hotkey: '1', color: LCARS.blue }
const CORE: SectionSpec = { id: 'core', label: 'MAIN ENGINEERING', hotkey: '2', color: LCARS.violet }
const RECORD: SectionSpec = { id: 'record', label: 'SERVICE RECORD', hotkey: '3', color: LCARS.lilac }

// Module state: open sections (loaded from $.store), and whether the sound toggle is muted
let open: Record<Section, boolean> = { crew: true, core: true, record: false }
let isOpenLoaded = false
let muted = false
let isFocus = false
let isBadgePaused = false
let logDraftKey = 0
let lastLogged: string | undefined
let logFile: string = 'Note'
// What the log field holds, so the Record button can file it as well as Enter
let logDraft = ''
// Block outlines rotate through the brand colors in this order
const OUTLINES = [LCARS.gold, LCARS.violet, LCARS.lilac, LCARS.red, LCARS.dim] as const

async function loadPrefs($: EngineInterface) {
  if (isOpenLoaded) return
  const saved = (await $.store.get('consoleOpen')) as Partial<Record<Section, boolean>> | undefined
  if (saved) open = { ...open, ...saved }
  muted = await isMuted($)
  isFocus = (await $.store.get('focusMode')) === true
  isBadgePaused = (await $.store.get('badgePaused')) === true
  isOpenLoaded = true
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

function meter(percent: number, width = 10): string {
  const filled = Math.round((percent / 100) * width)
  return '▰'.repeat(filled) + '▱'.repeat(width - filled)
}

export async function consoleSessionStart($: EngineInterface) {
  await $.command.register({ name: 'starfleet', description: 'Open the Starfleet console: viewscreen, briefing, crew decks, captain’s log, main engineering, service record. /starfleet focus shows only the comms badge', immediate: true })
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
  await $.store.set(key, { text, at: await $.clock.now(), summary: isShort ? text : undefined } satisfies LastOrder)
  $.ui.invalidate('ui.render')
  if (!isShort) void summarizeOrder($, key, text).catch(() => {})
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
        <Box flexDirection="column" rowGap={1} padding="sm" alignItems="center">
          {hasSvg
            ? <el.Svg source={commsBadgeSvg(isBadgePaused)} alt={isBadgePaused ? 'Starfleet comms badge, paused' : 'Starfleet comms badge, chirping'} width={320} height={236} isInteractive />
            : <Text color={LCARS.gold} bold>{'   ▲\n  ◢█◣\n ◥▀ ▀◤'}</Text>}
          <Box flexDirection="row" columnGap={2} flexWrap="wrap" justifyContent="center">
            <Button key="hail" label="🖖 Hail Starfleet" hotkey="f" variant="primary" onPress={() => pressed($, () => setFocus($, false))} />
            {hasSvg && <Button key="pause" label={isBadgePaused ? '▶ Resume comms' : '⏸ Pause comms'} hotkey="p" plain onPress={() => pressed($, async () => {
              isBadgePaused = !isBadgePaused
              await $.store.set('badgePaused', isBadgePaused)
              $.ui.invalidate('ui.render')
            })} />}
          </Box>
        </Box>
      )
    }
    const now = await $.clock.now()
    const width = Math.max(240, Math.min(560, ((e.props.bodyColumns ?? 50) - 4) * 8))
    const a = await read($, activity)
    const alert = await read($, redAlert)
    const percent = await read($, assimilation)
    const tier = tierOf(percent)
    const captain = await read($, isCaptainMode)
    const project = basename(await $.session.cwd())
    const seconds = a.turnStartedAt === null ? null : Math.floor((now - a.turnStartedAt) / 1000)
    const condition = alert.isOn
      ? { label: 'RED', color: LCARS.red }
      : tier >= 2 ? { label: 'BORG', color: LCARS.green }
      : tier === 1 ? { label: 'YELLOW', color: LCARS.gold }
      : { label: 'GREEN', color: LCARS.green }
    const voyage = await readVoyage($)
    const course = courseOf(voyage)
    const warpMs = voyage.warpMs + (seconds ?? 0) * 1000

    // Every block gets an outline; the colors rotate gold, violet, lilac, red, grey
    let outlineAt = 0
    const nextOutline = () => OUTLINES[outlineAt++ % OUTLINES.length]!
    const block = (key: string, children: RenderElement | (RenderElement | false | null | undefined)[]) => (
      <Box key={key} flexDirection="column" rowGap={1} borderStyle="round" borderColor={nextOutline()} paddingX={1}>{children}</Box>
    )

    // An LCARS section: a colored pill, the header button, its access code and a summary
    const section = (s: SectionSpec, summary: string, body: () => RenderElement) => (
      <Box key={'box-' + s.id} flexDirection="column" rowGap={open[s.id] ? 1 : 0} borderStyle="round" borderColor={nextOutline()} paddingX={1}>
        <Box flexDirection="row" columnGap={1} alignItems="center">
          <Text backgroundColor={s.color} color={LCARS.ink}>{'  '}</Text>
          <Button key={'sec-' + s.id} label={`${open[s.id] ? '▾' : '▸'} ${s.label}`} hotkey={s.hotkey} plain onPress={() => toggle($, s.id)} />
          <Text color={s.color} dimColor>{lcarsCode(s.label)}</Text>
          <Text dimColor>{summary}</Text>
        </Box>
        {open[s.id] && body()}
      </Box>
    )

    // ── Frame and viewscreen ──
    const frame = hasSvg
      ? <el.Svg source={lcarsFrameSvg(width, 'USS CLAUDE', lcarsCode(project), alert.isOn ? LCARS.red : LCARS.orange)} alt="USS Claude LCARS console" width={width} height={58} />
      : <Text backgroundColor={alert.isOn ? LCARS.red : LCARS.orange} color={LCARS.ink} bold> USS CLAUDE · LCARS {lcarsCode(project)} </Text>
    const tint = alert.isOn ? 'red' : tier >= 2 ? 'borg' : 'none'
    // Arrows either side of the viewscreen swap the planet; p steps forward
    const planet = planetOf(await planetFor($, project))
    const screenWidth = width - 56
    const viewscreen = (
      <Box flexDirection="row" columnGap={1} alignItems="center">
        <Button key="planet-prev" label="◀" plain dimColor onPress={() => cyclePlanet($, project, -1)} />
        {hasSvg
          ? <el.Svg source={viewscreenSvg(screenWidth, project, tint, planet.id)} alt={`Viewscreen: the ship in standard orbit around ${project}, a ${planet.name} planet`} width={screenWidth} height={128} isInteractive />
          : <Text color={LCARS.blue}>{`   ·   ✦     (◯) ${planet.name}   >=<    ·   ✦  `}</Text>}
        <Button key="planet-next" label="▶" hotkey="p" plain dimColor onPress={() => cyclePlanet($, project, 1)} />
      </Box>
    )

    // ── Status and controls ──
    const status = (
      <Box flexDirection="column" rowGap={1}>
        {alert.isOn && hasSvg && <el.Svg source={redAlertSvg(alert.reason, width)} alt={`Red alert: ${alert.reason}`} width={width} height={34} isInteractive />}
        <Box flexDirection="row" columnGap={1} flexWrap="wrap" alignItems="center">
          <Text color={LCARS.peach} size="title" weight="bold" tabular>STARDATE {stardate(now)}</Text>
          <Text backgroundColor={condition.color} color={LCARS.ink} size="caption" bold> COND {condition.label} </Text>
        </Box>
        <Box flexDirection="column">
          <Text>
            <Text color={LCARS.violet}>{'COURSE'.padEnd(10)}</Text>
            <Text color={course.isBreach ? LCARS.red : LCARS.green}>{meter((course.stage / (COURSE.length - 1)) * 100, COURSE.length - 1)} </Text>
            <Text color={course.isBreach ? LCARS.red : course.stage ? LCARS.gold : LCARS.dim} bold>{course.label}</Text>
          </Text>
          <Text dimColor>{' '.repeat(10)}{course.detail}</Text>
          <Text>
            <Text color={LCARS.violet}>{'TIME LOG'.padEnd(10)}</Text>
            <Text tabular>on duty {duration(now - voyage.startedAt)} · at warp {duration(warpMs)} · {voyage.orders + a.turnCalls} orders</Text>
            {seconds !== null && <Text color={LCARS.gold} tabular> · this mission {duration(seconds * 1000)}</Text>}
          </Text>
        </Box>
        {/* Admin controls on an invisible 3-column grid, so they line up */}
        <Box flexDirection="column" rowGap={0}>
          <Box flexDirection="row">
            <Box width="34%"><Button key="captain" label={captain ? '🖖 Captain mode' : 'Captain mode'} hotkey="c" plain onPress={() => pressed($, () => update($, isCaptainMode, v => !v))} /></Box>
            <Box width="33%"><Button key="focus" label="Focus" hotkey="f" plain onPress={() => pressed($, () => setFocus($, true))} /></Box>
            <Box width="33%"><Button key="alert" label={alert.isOn ? 'Belay red alert' : 'Red alert'} hotkey="r" plain onPress={() => toggleRedAlert($)} /></Box>
          </Box>
          <Box flexDirection="row">
            <Box width="34%"><Button key="sound" label={muted ? 'Unmute' : 'Mute'} hotkey="o" plain dimColor={muted} onPress={async () => {
              muted = !muted
              await $.store.set('muted', muted)
              if (!muted) void chirp($)
              $.ui.invalidate('ui.render')
            }} /></Box>
            <Box width="33%"><Button key="closure" label="Close mission" hotkey="z" plain onPress={() => pressed($, () => sendClosure($))} /></Box>
            <Box width="33%" />
          </Box>
        </Box>
      </Box>
    )

    // ── Last order: a toast-style card with the captain's latest prompt ──
    const order = (await $.store.get(await lastOrderKey($))) as LastOrder | undefined
    const lastOrder = order && (
      <Box flexDirection="column">
        <Text>
          <Text color={LCARS.gold} bold>💬 LAST ORDER </Text>
          <Text dimColor>{duration(now - order.at)} ago</Text>
        </Text>
        <Text>{order.summary ?? gist(order.text)}</Text>
        {!order.summary && <Text dimColor italic>Summarizing…</Text>}
        <Button key="reorder" label="Reissue" hotkey="u" plain dimColor onPress={() => pressed($, () => $.prompt.fill({ text: order.text, mode: 'replace' }))} />
      </Box>
    )

    // ── Mission briefing ──
    const b = currentBriefing()
    const briefing = b.isDismissed ? null : b.status === 'none' ? (
      <Button key="brief" label="Mission briefing" hotkey="b" plain onPress={() => pressed($, () => buildBriefing($))} />
    ) : (
      <Box flexDirection="column">
        <Box flexDirection="row" columnGap={1}>
          <Text backgroundColor={LCARS.peach} color={LCARS.ink} bold> MISSION BRIEFING </Text>
          <Text dimColor>{b.status === 'loading' ? 'Decoding transmission…' : `from ${b.source}`}</Text>
        </Box>
        {b.lines.map(line => {
          const [head, ...rest] = line.split(':')
          return rest.length && /^[A-Z ]+$/.test(head!)
            ? <Text><Text color={LCARS.peach} bold>{head}:</Text>{rest.join(':')}</Text>
            : <Text>{line}</Text>
        })}
        {b.status === 'ready' && <Button key="ack" label="Acknowledged" hotkey="k" plain dimColor onPress={() => pressed($, () => { dismissBriefing(); $.ui.invalidate('ui.render') })} />}
      </Box>
    )

    // ── Crew decks ──
    const crew = await crewNow($)
    const crewBody = () => (
      <Box flexDirection="column" rowGap={1}>
        {crew.length === 0 && <Text dimColor>Scanning for crew…</Text>}
        {crew.length > 0 && hasSvg && (
          <el.Svg source={crewSvg(crew, width - 24)} alt={crew.map(c => `${c.name} (${c.project}) on ${c.deck}`).join(', ')} width={width - 24} height={DECKS.length * DECK_H + 8} isInteractive />
        )}
        {!hasSvg && crew.map(c => (
          <Text>
            <Text color={LCARS.peach} bold>{c.name.padEnd(8)}</Text> {c.project.padEnd(16)} <Text color={LCARS.lilac}>{c.deck.toUpperCase()}</Text>
          </Text>
        ))}
        <Button key="rescan" label="Rescan + sync crew" hotkey="n" plain onPress={() => pressed($, async () => {
          await scanCrew($)
          $.ui.invalidate('ui.render')
          void $.prompt.submit({ text: crewSyncPrompt() }).catch(() => {})
          $.ui.toast('📡 Crew rescanned. Sending the roster to Starfleet Command…')
        })} />
      </Box>
    )

    // ── Captain's log: a capture field and its buttons, right in the console ──
    const log = await readLog($)
    const recordLog = async (value: string) => {
      if (!value.trim()) return
      const entry = await addLogEntry($, filed(logFile, value.trim()))
      void chirp($)
      lastLogged = `Logged · ${entry.stardate}`
      logDraft = ''
      logDraftKey += 1
      $.ui.invalidate('ui.render')
    }
    const logButton = (
      <Box flexDirection="column" rowGap={1}>
        <Box flexDirection="row" columnGap={1} alignItems="center">
          <Text color={LCARS.peach} bold>📓 CAPTAIN’S LOG</Text>
          <Text dimColor>{lastLogged ?? (log.length ? `${log.length} entries` : '')}</Text>
        </Box>
        {/* Kind, entry and Record sit on one row so they read as one control */}
        <Box flexDirection="row" columnGap={1} alignItems="center">
          {'Select' in el && (
            <el.Select key="log-file" label="" value={logFile} options={LOG_FILES.map(f => ({ value: f }))} onSelect={value => {
              logFile = value
              $.ui.invalidate('ui.render')
            }} />
          )}
          {'Input' in el && (
            <Box flexGrow={1}>
              <el.Input key={'log-' + logDraftKey} value="" submitLabel="record" onInput={value => { logDraft = value }} onSubmit={recordLog} />
            </Box>
          )}
          <Box backgroundColor={LCARS.lilac} paddingX={1}>
            <Button key="record" label="⏺ Record" plain onPress={() => pressed($, () => recordLog(logDraft))} />
          </Box>
        </Box>
        <Box flexDirection="row">
          <Box width="34%"><Button key="sync" label="📡 Sync" hotkey="s" plain onPress={() => pressed($, () => {
            void $.prompt.submit({ text: syncPrompt() }).catch(() => {})
            $.ui.toast('📡 Transmitting records to Starfleet Command…')
          })} /></Box>
          <Box width="33%"><Button key="md" label="💾 Save" hotkey="d" plain onPress={() => pressed($, () => saveMarkdown($))} /></Box>
          <Box width="33%"><Button key="ask" label="💬 Ask" hotkey="a" plain onPress={() => pressed($, () => $.prompt.fill({ text: 'Using my captain’s log, ', mode: 'replace' }))} /></Box>
        </Box>
      </Box>
    )

    // ── Main engineering: the warp core, laid out as labeled readouts ──
    const flags = coreFlags(now)
    const window = flags.tokens && percent ? Math.round(flags.tokens / (percent / 100)) : 0
    const readout = (label: string, value: RenderElement | string, color?: string) => (
      <Text><Text color={LCARS.violet}>{label.padEnd(12)}</Text><Text color={color}>{value}</Text></Text>
    )
    const coreBody = () => (
      <Box flexDirection="row" columnGap={2}>
        {hasSvg
          ? <el.Svg source={coreSvg(percent, seconds !== null, flags.isEjecting)} alt={`Warp core at ${percent}% load`} width={80} height={200} isInteractive />
          : <Text color={LCARS.blue}>{'▮\n'.repeat(7)}</Text>}
        <Box flexDirection="column" rowGap={1}>
          <Box flexDirection="column">
            {readout('CORE LOAD', `${String(percent).padStart(3)}%  ${meter(percent)}`, tier >= 2 ? LCARS.green : LCARS.text)}
            {readout('DILITHIUM', flags.tokens ? `${Math.round(flags.tokens / 1000)}k of ${Math.round(window / 1000)}k tokens` : 'Reading…')}
            {readout('CONDITION', tier ? TIER_TEXT[tier]! : 'Nominal', tier ? LCARS.green : LCARS.text)}
            {readout('WARP DRIVE', seconds === null ? 'Standing by' : `Engaged · ${seconds}s`, seconds === null ? LCARS.dim : LCARS.gold)}
          </Box>
          {flags.isEjecting && <Text color={LCARS.red} bold>CORE EJECTED · writing handoff</Text>}
          <Box flexDirection="row" columnGap={2} flexWrap="wrap">
            <Button key="eject" label={flags.isArmed ? 'Confirm eject' : 'Eject core'} hotkey="e" plain onPress={() => pressed($, () => ejectCore($))} />
            {tier >= 2 && <Button key="compact" label="Compact memory" hotkey="m" onPress={() => pressed($, () => $.session.compact())} />}
          </Box>
          <Text dimColor italic>Eject writes a handoff and continues in a new chat. The project stays open.</Text>
        </Box>
      </Box>
    )

    // ── Service record ──
    const r = await read($, record)
    const rank = rankOf(r.turns)
    const nextRank = RANKS.find(x => x.at > r.turns)
    const recordBody = () => (
      <Box flexDirection="column" rowGap={1}>
        <Box flexDirection="row" columnGap={2} alignItems="center">
          {hasSvg
            ? <el.Svg source={pipsSvg(rank.pips)} alt={`${rank.pips} rank pips`} width={rank.pips * 26 + 18} height={40} />
            : <Text color={LCARS.gold}>{'●'.repeat(rank.pips)}</Text>}
          <Text bold>{rank.name}</Text>
          <Text dimColor>{nextRank ? `${nextRank.at - r.turns} missions to ${nextRank.name}` : 'Flag rank achieved'}</Text>
        </Box>
        <Box flexDirection="column">
          {readout('MISSIONS', String(r.turns))}
          {readout('TOURS', String(r.sessions))}
          {readout('DEFLECTED', String(r.blocked))}
          {readout('SCANS', String(r.scans))}
        </Box>
      </Box>
    )

    return (
      <Box flexDirection="column" rowGap={1} padding="sm">
        {frame}
        {block('b-view', viewscreen)}
        {block('b-status', status)}
        {lastOrder && block('b-order', lastOrder)}
        {briefing && block('b-brief', briefing)}
        {section(CREW, crew.length ? `${crew.length} aboard` : 'Not scanned', crewBody)}
        {block('b-log', logButton)}
        {section(CORE, tier ? TIER_TEXT[tier]! : `Core load ${percent}%`, coreBody)}
        {section(RECORD, `${rank.name} · ${r.turns} missions`, recordBody)}
      </Box>
    )
  })
}
