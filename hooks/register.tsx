import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { ServiceRecord } from '../types'
import { consoleSessionStart, registerConsole, rememberOrder } from './console'
import { coreSessionStart, registerCore } from './core'
import { RANKS, errText, hashOf, pipsSvg, rankOf, serial } from './shared'
import { HEAD_COLOR, LCARS, hail, onDark } from './theme'
import { registerAbout } from './about'
import { crewSessionStart, crewTurnComplete, registerCrew } from './crew'
import { logSessionStart, logTyping, missionTurnComplete, recordsJson, registerLog } from './log'
import { hostileReason } from './shields'
import { opsSessionStart, opsTurnComplete, opsTurnStart, registerOps, setRedAlert } from './ops'
import { CAPTAIN_PROMPT, registerTakeover } from './takeover'

// Session state that redraws its readers when written (and survives a reload)
const isCaptainMode = atom({ plugin: 'starfleet', key: 'isCaptainMode' } as const, false)
const record = atom({ plugin: 'starfleet', key: 'record' } as const, { sessions: 0, turns: 0, blocked: 0, scans: 0 })

// Each block below shows a different kind of mod power, numbered to match the tour.

const PANE = 'starfleet-record'
const SENSOR_TOOL = 'mcp__starfleet__sensor_scan'
const SHIP_PANE = 'starfleet-ship'

// Claims more width than any pane, so the surface scales it to fill its box (see crewSvg)
const STARSHIP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 300" width="1600" height="960">
  <defs>
    <radialGradient id="space" cx="50%" cy="40%" r="80%"><stop offset="0" stop-color="#1b1f4a"/><stop offset="1" stop-color="#05060f"/></radialGradient>
    <linearGradient id="hull" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eef1f6"/><stop offset="1" stop-color="#8d96a8"/></linearGradient>
    <radialGradient id="glowBlue" r="50%"><stop offset="0" stop-color="#e0f2ff"/><stop offset=".4" stop-color={LCARS.blue}/><stop offset="1" stop-color={LCARS.blue} stop-opacity="0"/></radialGradient>
    <radialGradient id="glowOrange" r="50%"><stop offset="0" stop-color="#fff3d6"/><stop offset=".4" stop-color="#ff9a3c"/><stop offset="1" stop-color="#ff9a3c" stop-opacity="0"/></radialGradient>
    <radialGradient id="planet" cx="35%" cy="35%" r="70%"><stop offset="0" stop-color="#c79bff"/><stop offset="1" stop-color="#3b1f6b"/></radialGradient>
  </defs>
  <rect width="500" height="300" fill="url(#space)"/>
  <g fill="#fff">
    <circle cx="30" cy="40" r="1.2"/><circle cx="90" cy="250" r="1"/><circle cx="150" cy="30" r="1.4"/><circle cx="210" cy="270" r="1"/>
    <circle cx="300" cy="20" r="1"/><circle cx="470" cy="60" r="1.3"/><circle cx="440" cy="280" r="1"/><circle cx="20" cy="160" r="1"/>
    <circle cx="360" cy="250" r="1.5"/><circle cx="250" cy="60" r="0.8"/><circle cx="120" cy="120" r="0.8"/><circle cx="480" cy="180" r="0.9"/>
  </g>
  <g stroke="#9fc8ff" stroke-linecap="round" opacity=".45">
    <line x1="0" y1="118" x2="90" y2="118" stroke-width="1.5"/><line x1="0" y1="178" x2="120" y2="178" stroke-width="1"/>
    <line x1="10" y1="205" x2="70" y2="205" stroke-width="1"/><line x1="0" y1="90" x2="50" y2="90" stroke-width="1"/>
  </g>
  <circle cx="420" cy="230" r="46" fill="url(#planet)"/>
  <ellipse cx="420" cy="230" rx="78" ry="13" fill="none" stroke="#e7d2ff" stroke-width="3" opacity=".7" transform="rotate(-14 420 230)"/>
  <g>
    <ellipse cx="148" cy="152" rx="40" ry="14" fill="url(#glowBlue)" opacity=".8"/>
    <path d="M196 166 L238 138 L250 142 L212 172 Z" fill="#9aa3b5"/>
    <path d="M196 140 L238 128 L248 134 L210 148 Z" fill="#9aa3b5"/>
    <rect x="150" y="112" width="120" height="16" rx="8" fill="url(#hull)"/>
    <rect x="150" y="166" width="120" height="16" rx="8" fill="url(#hull)"/>
    <rect x="160" y="116" width="96" height="3" rx="1.5" fill="#4fb3ff" opacity=".9"/>
    <rect x="160" y="170" width="96" height="3" rx="1.5" fill="#4fb3ff" opacity=".9"/>
    <circle cx="272" cy="120" r="9" fill="url(#glowOrange)"/><circle cx="272" cy="174" r="9" fill="url(#glowOrange)"/>
    <path d="M210 150 Q240 136 300 142 L310 160 Q260 168 214 162 Z" fill="url(#hull)"/>
    <circle cx="302" cy="151" r="7" fill="url(#glowBlue)"/>
    <path d="M286 146 L318 120 L332 122 L304 150 Z" fill="#b8c0cf"/>
    <ellipse cx="350" cy="112" rx="70" ry="20" fill="url(#hull)"/>
    <ellipse cx="350" cy="106" rx="28" ry="7" fill="#d8dde7"/>
    <ellipse cx="350" cy="102" rx="9" ry="4" fill="#4fb3ff"/>
    <path d="M286 116 Q350 128 414 116" fill="none" stroke="#6b7488" stroke-width="1.5"/>
    <g fill="#ffe9a8"><circle cx="305" cy="114" r="1.3"/><circle cx="320" cy="117" r="1.3"/><circle cx="380" cy="117" r="1.3"/><circle cx="395" cy="114" r="1.3"/></g>
    <text x="336" y="125" font-family="monospace" font-size="7" fill="#4a5265">NCC-2026</text>
  </g>
</svg>`

const STARSHIP_ASCII = `                    ___________________
          __       /                   \\
   ======|  |=====<   U S S  C L A U D E >
          ‾‾  \\    \\___________________/
     ==========\\_____/
          __   /
   ======|  |=/`


const MAKE_IT_SO = /^\s*(make it so|engage)[.!]*\s*$/i
// What "make it so" stands for, written into the captain's own message so they see what Claude is told
export const MAKE_IT_SO_ORDER = 'Go ahead with the one step you just proposed, and only that step. Ask me first before anything destructive or anything beyond it.'
// A question about one of these gets no one-key "make it so" suggestion: the captain should answer it in words
const RISKY_ASK = /\b(force[- ]?push|push --force|delete|remove|drop|reset|wipe|overwrite|discard|destroy|deploy|publish|merge)\b/i

const PLANETS = ['Class M, breathable atmosphere', 'Gas giant, 14 moons', 'Class L, dense forests', 'Ice world, subsurface ocean', 'Barren rock, trace dilithium']
const LIFE = ['No life signs', '3 life signs, humanoid', 'Thousands of life signs, non-humanoid', 'One life sign. It is… a cat.', 'Faint signs, possibly cloaked']

// Redraw once a second during a turn, for the live timers (the Svg art animates itself)
let tickTimer: Timer | undefined

// The record only ever counts up. Each count reads the saved record first and keeps the higher of
// it and this chat's copy, field by field, so a chat that counts before its copy has loaded (a
// new chat, a reload), or one that is behind another chat, never writes lower numbers over it
const recordLock = serial()

function higher(a: Partial<ServiceRecord> | undefined, b: ServiceRecord): ServiceRecord {
  return {
    sessions: Math.max(a?.sessions ?? 0, b.sessions),
    turns: Math.max(a?.turns ?? 0, b.turns),
    blocked: Math.max(a?.blocked ?? 0, b.blocked),
    scans: Math.max(a?.scans ?? 0, b.scans),
  }
}

async function bumpRecord($: EngineInterface, key: keyof ServiceRecord) {
  await recordLock(async () => {
    const merged = higher((await $.store.get('record')) as Partial<ServiceRecord> | undefined, await read($, record))
    const next = { ...merged, [key]: merged[key] + 1 }
    await $.store.set('record', next)
    await update($, record, () => next)
  })
}

async function loadRecord($: EngineInterface) {
  const saved = (await $.store.get('record')) as Partial<ServiceRecord> | undefined
  await update($, record, r => higher(saved, r))
}

export const register: Register = on => {
  // Every starfleet pane on a dark background, in the app's light mode too (see onDark). Registered
  // first, so it wraps what each pane's own hook draws
  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    const tree = await next(e)
    return typeof e.requestId === 'string' && e.requestId.startsWith('starfleet') && tree ? onDark(tree, e.surface !== 'terminal') : tree
  })
  // 13-20 live in ops.tsx; the takeover, warp core, captain's log and crew decks in their own files
  registerOps(on)
  registerTakeover(on)
  registerCore(on)
  registerLog(on)
  registerCrew(on)
  registerConsole(on)
  registerAbout(on)

  on('session.start', async ($, e, next) => {
    // Cheap registrations first, then each module on its own: one failing start never stops the rest
    const steps: (() => Promise<unknown>)[] = [
      // 2. A tool Claude itself can call
      () => $.tool.register({
        name: 'sensor_scan',
        description: 'Run a starship long-range sensor scan on a target (planet, star, ship or anything). Returns a fun, fictional sensor report.',
        inputSchema: { type: 'object', properties: { target: { type: 'string', description: 'What to scan' } }, required: ['target'] },
      }),
      () => $.command.register({ name: 'captain-mode', description: 'Toggle captain mode: Claude answers as the ship’s computer', immediate: true }),
      () => $.command.register({ name: 'service-record', description: 'Show your Starfleet service record', immediate: true }),
      () => $.command.register({ name: 'starship', description: 'Show the USS Claude on the viewscreen', immediate: true }),
      () => loadRecord($),
      () => opsSessionStart($),
      () => logSessionStart($),
      () => crewSessionStart($),
      () => coreSessionStart($),
      () => consoleSessionStart($),
    ]
    for (const step of steps) await step().catch(err => $.ui.log(`starfleet: a start step failed: ${errText(err)}`))
    return next(e)
  })

  // Count a fresh session (not a reload) in the cross-session record
  on('classic.SessionStart', { source: ['startup'] }, async ($, e, next) => {
    await bumpRecord($, 'sessions')
    return next(e)
  })
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    await loadRecord($)
    return next(e)
  })

  // 1. Shields: refuse the common destructive Bash commands (shields.ts says what they catch)
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const reason = hostileReason(String(e.command ?? ''))
    if (!reason) return next(e)
    const deny = `🛡️ Starfleet shields: "${e.command.slice(0, 60)}" was blocked by Tactical (${reason}). Ask the captain to run it themselves.`
    // The block holds even if the fanfare fails
    try {
      await bumpRecord($, 'blocked')
      $.ui.toast('🛡️ Shields held. Hostile command deflected.')
      // 20. The computer says it out loud
      void $.audio.speak('Warning. Hostile command deflected. Shields holding.').catch(() => {})
      await setRedAlert($, true, 'Hostile command deflected')
    } catch {
      // the deny below still stands
    }
    return { deny }
  })

  // 2. ...and the hook that answers that tool
  on('tool.call', { tool: SENSOR_TOOL }, async ($, e) => {
    const target = String((e as { target?: unknown }).target ?? 'the void')
    const h = hashOf(target)
    await bumpRecord($, 'scans')
    return {
      result: [
        `SENSOR REPORT: ${target}`,
        `Classification: ${PLANETS[h % PLANETS.length]}`,
        `Life signs: ${LIFE[(h >> 3) % LIFE.length]}`,
        `Distance: ${((h % 900) / 10 + 0.4).toFixed(1)} light-years`,
        `Threat level: ${['minimal', 'low', 'moderate', 'unknown'][(h >> 5) % 4]}`,
        '(Fictional report from the starfleet mod. Relay it to the captain in character.)',
      ].join('\n'),
    }
  })

  // The captain's records, read by Claude through the starfleet_records tool (log.tsx builds them)
  on('tool.call', { tool: 'mcp__starfleet__starfleet_records' }, async $ => ({ result: await recordsJson($) }))

  // 3. "Make it so": approve the one step Claude proposed, spelled out in the message itself (nothing hidden)
  on('prompt.submit', async ($, e, next) => {
    const isMakeItSo = !e.command && !e.isMeta && MAKE_IT_SO.test(e.text)
    // "Make it so" is a go-ahead, not an order worth reissuing; and a store hiccup never blocks the prompt
    if (!isMakeItSo) await rememberOrder($, e).catch(() => {})
    if (!isMakeItSo) return next(e)
    return next({ ...e, text: `${e.text.trim().replace(/[.!]*$/, '')}: ${MAKE_IT_SO_ORDER}` })
  })

  // 4. Captain mode: add a section to Claude's system prompt
  on('command.run', { command: 'captain-mode' }, async $ => {
    const isOn = !(await read($, isCaptainMode))
    await update($, isCaptainMode, () => isOn)
    $.ui.toast(isOn ? '🖖 Captain mode on. The computer is listening.' : 'Captain mode off. Back to civilian life.')
    return {}
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!(await read($, isCaptainMode))) return composed
    return { sections: [...composed.sections, { id: 'starfleet:captain', text: CAPTAIN_PROMPT, scope: 'session' }] }
  })

  // 5. Relabel transcript messages (captain mode only)
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (!(await read($, isCaptainMode)) || e.props.origin.kind !== 'composer') return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const theirs = await next(e)
    return (
      <Box flexDirection="column">
        <Text color={LCARS.gold} bold>👨‍✈️ Captain</Text>
        {theirs}
      </Box>
    )
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (!(await read($, isCaptainMode)) || !e.props.isFirstOfReply) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const theirs = await next(e)
    return (
      <Box flexDirection="column">
        <Text color={LCARS.violet} bold>🖥️ Ship’s Computer</Text>
        {theirs}
      </Box>
    )
  })

  // 6. Add a label to the footer's mode list
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (!(await read($, isCaptainMode))) return next(e)
    return next({ ...e, props: { ...e.props, modes: [...e.props.modes, '🖖 Captain mode'] } })
  })

  // 7. Dress up the question dialog Claude opens
  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    const { Box, Text } = $.ui.resolve(e)
    const theirs = await next(e)
    return (
      <Box flexDirection="column">
        <Text color={LCARS.orange} bold>📡 Incoming transmission. The computer requests orders, Captain.</Text>
        {theirs}
      </Box>
    )
  })

  // 8. A once-a-second tick while Claude works
  on('turn.start', async ($, e, next) => {
    await opsTurnStart($, e.agentId)
    if (!e.agentId) {
      tickTimer?.cancel()
      tickTimer = $.clock.every(1000, async () => {
        if ((await $.clock.now()) >= logTyping.until) $.ui.invalidate('ui.render')
      })
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  // 9 + 10. When the turn ends: stop warp, count it, notify after long missions, suggest a reply
  on('turn.complete', async ($, e, next) => {
    await opsTurnComplete($, e.agentId, e.durationMs).catch(() => {})
    if (e.agentId) return next(e)
    tickTimer?.cancel()
    tickTimer = undefined
    $.ui.invalidate('ui.render')
    // Each step on its own: a failing count never skips the notice or the suggested reply
    await bumpRecord($, 'turns').catch(() => {})
    await $.session.usage().then(u => missionTurnComplete($, u.context.percent ?? 0)).catch(() => {})
    if (!e.isAborted) void hail($).catch(() => {})
    // The crew rescan can wait on git and gh; it redraws when it lands, so the turn doesn't wait for it
    void crewTurnComplete($).catch(() => {})
    const seconds = Math.round(e.durationMs / 1000)
    if (seconds >= 60 && !e.isAborted) {
      void $.ui.notify(`The away team has returned after ${seconds}s.`, { title: '🖖 Starfleet' }).catch(() => {})
    }
    if (!e.isAborted && /\?\s*$|\bshall I\b|\bwant me to\b/i.test(e.answer) && !RISKY_ASK.test(e.answer.slice(-400))) {
      void $.prompt.suggest({ text: 'make it so' }).catch(() => {})
    }
    return next(e)
  })

  // 12. A picture on the viewscreen: Svg where the surface has it, text art elsewhere
  on('command.run', { command: 'starship' }, async $ => {
    const opened = await $.ui.open({ id: SHIP_PANE, title: '🚀 Viewscreen', closeOnEscape: true })
    return opened.isPlaced ? {} : { text: `Viewscreen pane not shown: ${opened.reason}` }
  })

  on('ui.render', { component: 'Pane', requestId: SHIP_PANE }, async ($, e) => {
    const el = $.ui.resolve(e)
    const { Box, Text } = el
    return (
      <Box flexDirection="column" rowGap={1} padding="sm">
        <Text backgroundColor={HEAD_COLOR} color={LCARS.ink} bold> VIEWSCREEN · USS CLAUDE · NCC-2026 </Text>
        {'Svg' in el
          ? <Box width="100%"><el.Svg source={STARSHIP_SVG} alt="A starship with a saucer hull and two glowing warp nacelles, cruising past a ringed planet" /></Box>
          : <Text color={LCARS.violet}>{STARSHIP_ASCII}</Text>}
        <Text dimColor italic>Captain, she’s holding together. Mostly.</Text>
      </Box>
    )
  })

  // 11. A pane fed by $.state, with $.store keeping it across sessions
  on('command.run', { command: 'service-record' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: '🎖️ Service record', focus: true, closeOnEscape: true })
    return opened.isPlaced ? {} : { text: `Service record pane not shown: ${opened.reason}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const el = $.ui.resolve(e)
    const { Box, Text, Button } = el
    const r = await read($, record)
    const captain = await read($, isCaptainMode)
    const rank = rankOf(r.turns)
    const nextRank = RANKS.find(x => x.at > r.turns)
    const stat = (label: string, value: number, tip: string) => (
      <Box key={'stat-' + label}>
        <Text hover={{ color: '#ffcc33', bold: true }}>
          <Text color={LCARS.lilac}>{label.padEnd(18)}</Text>{value}  <Text dimColor>{tip}</Text>
        </Text>
      </Box>
    )
    return (
      <Box flexDirection="column" rowGap={1} padding="sm">
        <Text backgroundColor={HEAD_COLOR} color={LCARS.ink} bold> STARFLEET SERVICE RECORD </Text>
        <Box flexDirection="row" columnGap={2} alignItems="center">
          {'Svg' in el
            ? <el.Svg source={pipsSvg(rank.pips)} alt={`${rank.pips} rank pips`} width={rank.pips * 26 + 18} height={40} />
            : <Text color={LCARS.gold}>{'●'.repeat(rank.pips)}</Text>}
          <Text bold>{rank.name}</Text>
          <Text dimColor>{nextRank ? `${nextRank.at - r.turns} turns to ${nextRank.name}` : 'Highest rank achieved'}</Text>
        </Box>
        <Box flexDirection="column">
          {stat('Sessions served', r.sessions, 'kept across sessions in $.store')}
          {stat('Turns commanded', r.turns, 'counted at turn.complete')}
          {stat('Hostiles blocked', r.blocked, 'from the Bash shield')}
          {stat('Sensor scans', r.scans, 'Claude called your tool')}
        </Box>
        <Button
          key="captain"
          label={captain ? 'Captain mode: ON (c)' : 'Captain mode: off (c)'}
          hotkey="c"
          variant={captain ? 'primary' : 'secondary'}
          onPress={() => update($, isCaptainMode, v => !v)}
        />
      </Box>
    )
  })
}
