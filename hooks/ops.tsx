import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { StationCall } from '../types'
import { postLiveDeck } from './crew'
import { bumpMission, missionToolCall } from './log'
import { TEST_OR_BUILD, deckOfTool, errText, projectOf, serial, stardate } from './shared'
import { updateVoyage } from './voyage'
import { HEAD_COLOR, LCARS } from './theme'

// Session state (the same isCaptainMode value register.tsx reads and writes)
const isCaptainMode = atom({ plugin: 'starfleet', key: 'isCaptainMode' } as const, false)
const activity = atom({ plugin: 'starfleet', key: 'activity' } as const, { current: null, turnStartedAt: null, turnCalls: 0, recent: [] })
const redAlert = atom({ plugin: 'starfleet', key: 'redAlert' } as const, { isOn: false, reason: '' })

// More mod powers, numbered on from register.tsx's.

const BRIDGE_PANE = 'starfleet-bridge'
// Guards the health map (project path → diagnostics failing) against parallel tool calls
const healthLock = serial()
const TRANSLATOR_PANE = 'starfleet-translator'

const STATIONS: [RegExp, string][] = [
  [/^Bash$/, '🔧 Engineering'],
  [/^(Edit|Write|NotebookEdit)$/, '🛠️ Repair crew'],
  [/^Read$/, '📚 Library computer'],
  [/^(Grep|Glob)$/, '📡 Sensors'],
  [/^Web(Fetch|Search)$/, '🛰️ Long-range comms'],
  [/^Agent$/, '🚀 Away team'],
  [/^mcp__/, '📶 Subspace relay'],
]

function stationOf(tool: string): string {
  return STATIONS.find(([rx]) => rx.test(tool))?.[1] ?? '🖖 Ops'
}

const LANGUAGES: Record<string, { label: string; system: string }> = {
  klingon: {
    label: 'Klingon',
    system: 'Rewrite the user’s text as a fierce, honor-obsessed warrior would bellow it. Sprinkle in a few made-up guttural words with apostrophes. One or two sentences. Reply with the rewrite only.',
  },
  vulcan: {
    label: 'Vulcan',
    system: 'Restate the user’s text with total, emotionless logic, as a calm alien scientist would, noting anything illogical. One or two sentences. Reply with the restatement only.',
  },
  ferengi: {
    label: 'Ferengi',
    system: 'Restate the user’s text as a greedy alien merchant would, turning it into a deal and inventing a numbered "Rule of Acquisition" that applies. Two sentences. Reply with the restatement only.',
  },
  borg: {
    label: 'Borg',
    system: 'Restate the user’s text as an emotionless hive-mind collective would announce it, in the first person plural, ending with a note that resistance is unwise. One or two sentences. Reply with the restatement only.',
  },
  technobabble: {
    label: 'Technobabble',
    system: 'Restate the user’s text as a starship chief engineer’s urgent technobabble report full of made-up particles and subsystems. Two sentences. Reply with the report only.',
  },
}

const KLINGON_WORDS = /\b(qapla'?|nuqneh|petaq|bortas|heghlu'?meh|tlhingan)\b/i

const AWAY_TEAM_PROMPT = `You are a Starfleet away team: careful, read-only explorers.
Investigate exactly what you were sent to find using Read, Grep and Glob. Change nothing.
Report back in this shape:
AWAY TEAM REPORT
Mission: <one line>
Findings: <short bullets with file paths and line numbers>
Recommendation: <one line>
Keep the theme to the headings; the findings must be precise and technical.`

// Module state (fine to lose on reload)
let isKlingonTyped = false
let lang = 'klingon'
let heard = ''
let translation = ''
let isTranslating = false

// One status line, built from whatever is active
async function refreshStatus($: EngineInterface) {
  const alert = await read($, redAlert)
  const parts = [
    alert.isOn ? `🔴 RED ALERT · ${alert.reason || 'all hands to battle stations'}` : '',
    isKlingonTyped ? '🖖 Universal translator: Klingon detected' : '',
  ].filter(Boolean)
  $.ui.status(parts.length ? parts.join('   ') : undefined)
}

// Red alert, from a button, a command, or something going wrong
export async function setRedAlert($: EngineInterface, isOn: boolean, reason: string) {
  const was = await read($, redAlert)
  await update($, redAlert, () => ({ isOn, reason: isOn ? reason : '' }))
  await refreshStatus($)
  if (isOn === was.isOn) return
  if (isOn) {
    await bumpMission($, 'redAlerts')
    $.ui.toast(`🚨 Red alert! ${reason}`)
    void $.audio.play({ asset: 'assets/klaxon.wav' }).catch(() => $.ui.toast('🔇 Klaxon offline (no audio player).'))
    void $.audio.speak('Red alert. All hands to battle stations.').catch(() => {})
  } else {
    $.ui.toast('✅ Standing down.')
    void $.audio.speak('Condition green.').catch(() => {})
  }
}

export async function toggleRedAlert($: EngineInterface) {
  await setRedAlert($, !(await read($, redAlert)).isOn, 'Ordered by the captain')
}

// A pulsing red frame, drawn as an animated Svg where the surface has one
export function redAlertSvg(reason: string, width: number): string {
  const label = `RED ALERT · ${reason.replace(/[<&>]/g, '').toUpperCase().slice(0, 60)}`
  // Where Antonio isn't loaded the fallback runs wider, so a long label is squeezed to fit, never cut
  const room = width - 44
  const fit = label.length * 9.5 > room ? ` textLength="${room}" lengthAdjust="spacingAndGlyphs"` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 34" width="${width}" height="34">
<style>@keyframes p{0%,100%{opacity:.35}50%{opacity:1}}.p{animation:p 1s ease-in-out infinite}@media (prefers-reduced-motion:reduce){.p{animation:none}}</style>
<rect class="p" x="1.5" y="1.5" width="${width - 3}" height="31" rx="6" fill="#3a0d0d" stroke="#ff3b3b" stroke-width="3"/>
<circle class="p" cx="18" cy="17" r="6" fill="#ff3b3b"/>
<text x="32" y="22" font-family="Antonio,Arial Narrow,sans-serif" font-size="15" letter-spacing="1.5" fill="#ffd6d6"${fit}>${label}</text>
</svg>`
}

// Each request has a number; a reply to an older request than the latest is dropped
let translateRequest = 0

async function translate($: EngineInterface, text: string) {
  const request = ++translateRequest
  heard = text
  translation = ''
  isTranslating = true
  $.ui.invalidate('ui.render')
  try {
    const reply = await $.model.complete({ model: 'haiku', system: LANGUAGES[lang]!.system, prompt: text, maxTokens: 200 })
    if (request !== translateRequest) return
    translation = reply.isAnswered ? reply.text.trim() : `Translation matrix offline (${reply.reason}).`
  } catch (err) {
    if (request === translateRequest) translation = `Translation matrix offline (${errText(err)}).`
  } finally {
    if (request === translateRequest) isTranslating = false
    $.ui.invalidate('ui.render')
  }
}

// Called from register.tsx's own session.start, turn.start and turn.complete hooks
export async function opsSessionStart($: EngineInterface) {
  await $.command.register({ name: 'bridge', description: 'Open the live bridge: what every station is doing right now', immediate: true })
  await $.command.register({ name: 'red-alert', description: 'Sound red alert (klaxon, voice and status line)', immediate: true })
  await $.command.register({ name: 'translator', description: 'Open the universal translator', immediate: true })
  // 13. An agent type Claude can dispatch: starfleet:away-team
  await $.agent.register({
    name: 'away-team',
    description: 'Read-only exploration missions: find where something lives in the codebase, investigate a folder, or summarize files. Reports back as a Starfleet away team. Use when the captain says "send an away team".',
    prompt: AWAY_TEAM_PROMPT,
    tools: ['Read', 'Grep', 'Glob'],
  })
}

export async function opsTurnStart($: EngineInterface, agentId: string | undefined) {
  if (agentId) return
  const now = await $.clock.now()
  await update($, activity, a => ({ ...a, turnStartedAt: now, turnCalls: 0 }))
}

export async function opsTurnComplete($: EngineInterface, agentId: string | undefined, durationMs: number) {
  if (agentId) return
  const a = await read($, activity)
  // turnCalls folds into the voyage's orders here, so it starts over now (the console adds the two)
  await update($, activity, x => ({ ...x, turnStartedAt: null, current: null, turnCalls: 0 }))
  void postLiveDeck($, null).catch(() => {})
  await updateVoyage($, v => ({ ...v, warpMs: v.warpMs + durationMs, orders: v.orders + a.turnCalls }))
  // 15. A line in the transcript that the model never sees (captain mode only)
  if (await read($, isCaptainMode)) {
    $.ui.log(`📓 Captain’s log, stardate ${stardate(await $.clock.now())}: mission complete in ${Math.round(durationMs / 1000)}s, ${a.turnCalls} station orders.`)
  }
}

export function registerOps(on: On) {
  // 14. Feed a live pane from every tool call: before it runs and after
  on('tool.call', async ($, e, next) => {
    const call: StationCall = { id: e.tool_use_id ?? String(Math.random()), tool: e.tool, station: stationOf(e.tool), isDone: false, isErrored: false }
    await update($, activity, a => ({ ...a, current: call, turnCalls: a.turnCalls + 1, recent: [call, ...a.recent].slice(0, 8) }))
    void postLiveDeck($, deckOfTool(e.tool)).catch(() => {})
    let ran: Awaited<ReturnType<typeof next>> | undefined
    try {
      const result = (ran = await next(e))
      const isOk = result.deny === undefined && result.isError !== true
      // Bookkeeping after the tool ran must never turn its result into a failure
      await (async () => {
        if (e.tool === 'Bash' && result.deny === undefined && TEST_OR_BUILD.test(e.command)) {
          // Automatic red alert: failing diagnostics (tests, builds) raise it, passing ones stand it down
          const failed = result.isError === true
          // Keyed by the project, as the crew decks read it: a worktree counts for its project
          const project = projectOf(await $.session.cwd())!
          await healthLock(async () => $.store.set('health', { ...(((await $.store.get('health')) ?? {}) as Record<string, boolean>), [project]: failed }))
          if (failed) await setRedAlert($, true, 'Diagnostics failed')
          else if ((await read($, redAlert)).reason === 'Diagnostics failed') await setRedAlert($, false, '')
          const at = await $.clock.now()
          await updateVoyage($, v => ({ ...v, lastBuild: failed ? 'fail' : 'pass', lastBuildAt: at, greenBuilds: v.greenBuilds + (failed ? 0 : 1) }))
        }
        if (!isOk) return
        // The voyage: files changed, sensor sweeps and commits, for the console's course readout
        await missionToolCall($, e.tool, e.tool === 'Skill' ? e.skill : undefined, e.tool === 'Agent' ? e.subagent_type : undefined)
        if (e.tool === 'Edit' || e.tool === 'Write' || e.tool === 'NotebookEdit') {
          const path = 'file_path' in e ? String(e.file_path) : 'notebook_path' in e ? String(e.notebook_path) : ''
          if (path) await updateVoyage($, v => (v.files.includes(path) ? v : { ...v, files: [...v.files, path].slice(-500) }))
        } else if (/^(Read|Grep|Glob)$/.test(e.tool)) {
          await updateVoyage($, v => ({ ...v, scans: v.scans + 1 }))
        } else if (e.tool === 'Bash' && /\bgit\s+commit\b/.test(e.command)) {
          await updateVoyage($, v => ({ ...v, commits: v.commits + 1 }))
        }
      })().catch(() => {})
      return result
    } finally {
      const isErrored = !ran || ran.deny !== undefined || ran.isError === true
      await update($, activity, a => ({
        ...a,
        current: a.current?.id === call.id ? null : a.current,
        recent: a.recent.map(c => (c.id === call.id ? { ...c, isDone: true, isErrored } : c)),
      })).catch(() => {})
    }
  })

  on('command.run', { command: 'bridge' }, async $ => {
    const opened = await $.ui.open({ id: BRIDGE_PANE, title: '🖖 Live bridge', closeOnEscape: true })
    return opened.isPlaced ? {} : { text: `Bridge pane not shown: ${opened.reason}` }
  })

  on('ui.render', { component: 'Pane', requestId: BRIDGE_PANE }, async ($, e) => {
    const el = $.ui.resolve(e)
    const { Box, Text, Button } = el
    const a = await read($, activity)
    const alert = await read($, redAlert)
    const seconds = a.turnStartedAt === null ? null : Math.floor(((await $.clock.now()) - a.turnStartedAt) / 1000)
    const frameWidth = Math.max(220, Math.min(560, ((e.props.bodyColumns ?? 50) - 2) * 8))
    return (
      <Box flexDirection="column" rowGap={1} padding="sm">
        {alert.isOn && ('Svg' in el
          ? <el.Svg source={redAlertSvg(alert.reason, frameWidth)} alt={`Red alert: ${alert.reason}`} isInteractive />
          : <Text backgroundColor={LCARS.red} color={LCARS.ink} bold> RED ALERT · {alert.reason} </Text>)}
        <Box flexDirection="row" columnGap={1}>
          <Text backgroundColor={alert.isOn ? '#ff3333' : '#ff9966'} color={LCARS.ink} bold> LIVE BRIDGE </Text>
          <Text color={seconds === null ? 'success' : 'warning'}>
            {seconds === null ? '● Standing by' : `● Mission in progress · ${seconds}s · ${a.turnCalls} orders`}
          </Text>
        </Box>
        <Box flexDirection="column" borderStyle="round" borderColor={LCARS.violet} paddingX={1}>
          <Text color={LCARS.lilac} bold>NOW</Text>
          <Text>{a.current ? `${a.current.station} → ${a.current.tool}` : 'All stations idle.'}</Text>
        </Box>
        <Box flexDirection="column">
          <Text color={LCARS.lilac} bold>STATION LOG</Text>
          {a.recent.length === 0 && <Text dimColor>No orders yet. Ask me to do something.</Text>}
          {a.recent.map(c => (
            <Text dimColor={c.isDone && !c.isErrored} color={c.isErrored ? 'error' : undefined}>
              {c.isDone ? (c.isErrored ? '✗' : '✓') : '…'} {c.station.padEnd(20)} {c.tool}
            </Text>
          ))}
        </Box>
        <Button key="red-alert" label={alert.isOn ? 'Stand down (r)' : 'Red alert (r)'} hotkey="r" onPress={() => toggleRedAlert($)} />
      </Box>
    )
  })

  // 16. Sound: a klaxon file of the mod's own, plus the computer's spoken voice
  on('command.run', { command: 'red-alert' }, async $ => {
    await toggleRedAlert($)
    return {}
  })

  // 17. A pane that calls a model of its own
  on('command.run', { command: 'translator' }, async $ => {
    const opened = await $.ui.open({ id: TRANSLATOR_PANE, title: '🌐 Universal translator', focus: true, closeOnEscape: true })
    return opened.isPlaced ? {} : { text: `Translator pane not shown: ${opened.reason}` }
  })

  on('ui.render', { component: 'Pane', requestId: TRANSLATOR_PANE }, async ($, e) => {
    const el = $.ui.resolve(e)
    const { Box, Text, Button } = el
    return (
      <Box flexDirection="column" rowGap={1} padding="sm">
        <Text backgroundColor={HEAD_COLOR} color={LCARS.ink} bold> UNIVERSAL TRANSLATOR </Text>
        {'Select' in el && (
          <el.Select
            key="language"
            label="Translate into"
            value={lang}
            options={Object.entries(LANGUAGES).map(([value, l]) => ({ value, label: l.label }))}
            onSelect={value => {
              lang = value
              if (heard) void translate($, heard).catch(() => {})
              else $.ui.invalidate('ui.render')
            }}
          />
        )}
        {'Input' in el ? (
          <el.Input
            key="phrase"
            label="Say"
            placeholder="I need a coffee before standup"
            value=""
            submitLabel="translate"
            autoFocus
            onSubmit={value => (value.trim() ? translate($, value.trim()) : undefined)}
          />
        ) : (
          <Text dimColor>This console has no keyboard.</Text>
        )}
        {heard && <Text dimColor>You: “{heard}”</Text>}
        {isTranslating && <Text color="warning">◌ Calibrating translation matrix…</Text>}
        {translation && (
          <Box flexDirection="column" rowGap={1}>
            <Text color={LCARS.peach} bold>{LANGUAGES[lang]!.label}: {translation}</Text>
            <Button key="speak" label="🔊 Speak it (s)" hotkey="s" onPress={() => {
              void $.audio.speak(translation).catch(() => $.ui.toast('🔇 No speech synthesizer here.'))
            }} />
          </Box>
        )}
      </Box>
    )
  })

  // 18. Watch the prompt as it's typed
  on('prompt.change', ($, e, next) => {
    const found = KLINGON_WORDS.test(e.text)
    if (found !== isKlingonTyped) {
      isKlingonTyped = found
      void refreshStatus($).catch(() => {})
    }
    return next(e)
  })

  // 19. Label each tool row with the station that ran it (captain mode only)
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (!(await read($, isCaptainMode))) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const theirs = await next(e)
    return (
      <Box flexDirection="column">
        <Text color={LCARS.lilac} dimColor>{stationOf(e.props.tool)}</Text>
        {theirs}
      </Box>
    )
  })
}
