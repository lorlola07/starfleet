import { atom, read, update } from 'claude-code'
import { isBandOn } from './prefs'
import type { EngineInterface, On, RenderElement } from 'claude-code'

import { addLogEntry, bumpMission } from './log'
import { redAlertSvg, setRedAlert } from './ops'
import { SHIP_PALETTE, SHIP_ROWS, pixels, stardate } from './shared'
import { HEAD_COLOR, LCARS } from './theme'

// The warp core (context and activity, with Eject core as the handoff), the assimilation
// meter (the Borg are a filling context window), and the ship gliding above the prompt.

const CORE_PANE = 'starfleet-core'

const redAlert = atom({ plugin: 'starfleet', key: 'redAlert' } as const, { isOn: false, reason: '' })
const assimilation = atom({ plugin: 'starfleet', key: 'assimilation' } as const, 0)
const activity = atom({ plugin: 'starfleet', key: 'activity' } as const, { current: null, turnStartedAt: null, turnCalls: 0, recent: [] })

// Module state
let lastTier = 0
let ejectArmedUntil = 0
let ejectingUntil = 0
let contextTokens = 0
let contextWindow = 0
let isMemoryAlertRaised = false

export function tierOf(percent: number): 0 | 1 | 2 | 3 {
  return percent >= 85 ? 3 : percent >= 70 ? 2 : percent >= 50 ? 1 : 0
}

export const TIER_TEXT = ['', 'Borg sensors detected', 'Assimilation in progress', 'Your context will be assimilated']

// ── Svg art (drawn isolated and animated by the surface: isInteractive) ──

function stars(width: number, height: number, count: number, seed: number, color: string): string {
  let out = ''
  let s = seed
  for (let i = 0; i < count; i++) {
    s = (s * 1103515245 + 12345) % 2147483648
    const x = s % width
    s = (s * 1103515245 + 12345) % 2147483648
    const y = s % height
    const size = s % 7 === 0 ? 2 : 1
    out += `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="${color}"/>`
  }
  return out
}

function glideSvg(width: number, tint: 'none' | 'red' | 'borg', now: number): string {
  const h = 40
  // Each redraw reloads the picture and restarts it, so every loop starts as far along as the clock
  // says: the ship carries on across the strip instead of jumping back on a redraw
  const along = (loopMs: number) => `${Number((-(now % loopMs) / 1000).toFixed(3))}s`
  const sky = tint === 'red' ? '#1d0707' : tint === 'borg' ? '#06140a' : '#070915'
  const far = stars(width, h, Math.round(width / 9), 7, '#6f7aa8')
  const near = stars(width, h, Math.round(width / 18), 13, '#e8ecff')
  const ship = pixels(SHIP_ROWS, SHIP_PALETTE, 2)
  const glow = tint === 'red' ? '#ff4d4d' : '#4fb3ff'
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${h}" width="${width}" height="${h}" shape-rendering="crispEdges">
<style>
@keyframes far{to{transform:translateX(-${width}px)}}
@keyframes near{to{transform:translateX(-${width}px)}}
@keyframes glide{0%{transform:translate(-60px,9px)}100%{transform:translate(${width + 10}px,9px)}}
@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}
@keyframes flame{0%,100%{opacity:1}50%{opacity:.35}}
.far{animation:far 24s linear infinite;animation-delay:${along(24000)}}.near{animation:near 9s linear infinite;animation-delay:${along(9000)}}
.ship{animation:glide 14s linear infinite;animation-delay:${along(14000)}}.bob{animation:bob .8s steps(2) infinite}
.flame{animation:flame .25s steps(2) infinite}
@media (prefers-reduced-motion:reduce){.far,.near,.ship,.bob,.flame{animation:none}.ship{transform:translate(${Math.round(width / 2)}px,9px)}}
</style>
<rect width="${width}" height="${h}" rx="6" fill="${sky}"/>
<g class="far">${far}<g transform="translate(${width},0)">${far}</g></g>
<g class="near">${near}<g transform="translate(${width},0)">${near}</g></g>
${tint === 'borg' ? `<g stroke="#2f7a3a" stroke-width="1" opacity=".35">${Array.from({ length: Math.ceil(width / 16) }, (_, i) => `<line x1="${i * 16}" y1="0" x2="${i * 16}" y2="${h}"/>`).join('')}<line x1="0" y1="20" x2="${width}" y2="20"/></g>` : ''}
<g class="ship"><g class="bob">
<rect class="flame" x="-6" y="8" width="5" height="2" fill="${glow}"/><rect class="flame" x="-6" y="16" width="5" height="2" fill="${glow}"/>
${ship}</g></g>
</svg>`
}

export function coreSvg(percent: number, isWorking: boolean, isEjecting: boolean): string {
  const color = percent >= 85 ? '#5bd46a' : percent >= 70 ? '#c27bff' : percent >= 50 ? '#8f8cff' : '#4fb3ff'
  const beat = isWorking ? 0.55 : 1.8
  const chambers = Array.from({ length: 7 }, (_, i) =>
    `<rect class="ch" style="animation-delay:${(i * beat) / 7}s" x="22" y="${16 + i * 22}" width="36" height="16" rx="5" fill="${color}"/>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 200" width="80" height="200">
<style>
@keyframes pulse{0%,100%{opacity:.3}40%{opacity:1}}
@keyframes eject{0%{transform:translateY(0)}20%{transform:translate(-2px,2px)}100%{transform:translateY(240px);opacity:0}}
.ch{animation:pulse ${beat}s ease-in-out infinite}
.core{${isEjecting ? 'animation:eject 2.4s ease-in forwards' : ''}}
@media (prefers-reduced-motion:reduce){.ch,.core{animation:none}}
</style>
<rect x="6" y="2" width="68" height="196" rx="10" fill="#0d1020" stroke="#2c3354"/>
<g class="core"><rect x="16" y="8" width="48" height="184" rx="20" fill="#16203d" stroke="${color}" stroke-opacity=".6"/>${chambers}</g>
${isEjecting ? '<text x="40" y="104" text-anchor="middle" font-family="Antonio,Arial Narrow,sans-serif" font-size="11" fill="#ff8a8a">EJECTED</text>' : ''}
</svg>`
}

// ── Eject core: a handoff document for a new chat ──

function handoffPrompt(path: string): string {
  return [
    'The captain has ejected the warp core. Write a handoff document: a stopping point the captain reads to pick up where they left off. It is a bookmark, not a task list for Claude.',
    `Save it to ${path} (create the folder if needed) and reply with the path and a two-line summary.`,
    'First read the newest earlier handoff in .claude/handoffs, if there is one. Never edit it or any other earlier handoff; this new file replaces it.',
    'Start the document with "Replaces: <that file name>" (or "Replaces: none").',
    'Sections: Goal (one sentence: what done looks like for this work); Where you left off (2-3 sentences); Closed since the last handoff (each item the earlier handoff left open that is now settled, one line on how; leave the section out when there is none);',
    'What is done and verified / what is not; Decisions made and why; Gotchas (what was tried and failed, and why, so it is not retried; and what the code does not show); Waiting on you; To try;',
    'How to verify (the commands that must pass, each with the result to expect, such as a test count); Files and places that matter (only those touched or needed this session); Open questions;',
    'and Pick up here (the first small thing to do when back, under 2 minutes, written to the captain, not as orders for Claude).',
    'Durable rules found this session (things that must hold in every later chat) go into memory or CLAUDE.md, not the handoff; the handoff names where each one was saved.',
    'Carry forward: every item in the earlier handoff\'s Not verified, Waiting on you, To try and Open questions is either listed under Closed or appears again in this one. Nothing is dropped silently.',
    'Each item goes in exactly one section. It is done and verified only once a test, a command or the captain confirmed it; anything else goes under Not verified, never both.',
    'Waiting on you holds only decisions the captain must make, each phrased as a choice. Checks for the captain to run go under To try, each with the result to expect. Open questions hold only unknowns not listed elsewhere.',
    'Write it in plain technical language, no theme. Include commands and paths exactly.',
    '',
    'An eject is not the end of the project: it stays open and continues in another chat. Do not close the mission or archive anything; only Close mission ends the project.',
    `Once the file is saved, start a new chat in this same project folder with start_session (initiation "user_asked", context "fresh", no worktree), titled after the work in progress. Its prompt: "Read the handoff at ${path}. Welcome the captain back in under 8 lines: where they left off, what is waiting on them, and the Pick up here step. Then stop and wait. Do not edit files, run commands, start sessions, or contact anyone until the captain says what to do."`,
    'If the app refuses to start it from this turn, propose the same session instead (initiation "own_initiative") so the captain can open it with one click, and say so in one line.',
  ].join('\n')
}

export async function ejectCore($: EngineInterface) {
  const now = await $.clock.now()
  if (now > ejectArmedUntil) {
    ejectArmedUntil = now + 6000
    $.ui.toast('⚠️ Eject core armed. Press Eject again within 6s to confirm.')
    $.ui.invalidate('ui.render')
    return
  }
  ejectArmedUntil = 0
  ejectingUntil = now + 2600
  // The stardate names only the day; the time keeps two handoffs on one day apart
  const time = new Date(now).toTimeString().slice(0, 5).replace(':', '')
  const path = `.claude/handoffs/handoff-${stardate(now)}-${time}.md`
  $.ui.toast('💥 Warp core ejected. Writing the handoff document…')
  void $.audio.speak('Warp core ejected.').catch(() => {})
  await bumpMission($, 'handoffs')
  await addLogEntry($, `Core ejected: handoff saved to ${path}`)
  $.ui.invalidate('ui.render')
  $.clock.after(2700, () => $.ui.invalidate('ui.render'))
  void $.prompt.submit({ text: handoffPrompt(path) }).catch(() => {})
}

// What the console needs to draw the core in its own pane
export function coreFlags(now: number) {
  return { isArmed: now < ejectArmedUntil, isEjecting: now < ejectingUntil, tokens: contextTokens, window: contextWindow }
}

// ── Assimilation: the context window as the Borg ──

// The tier last announced, whether the 90% alert is up, and the captain's answer to "still
// mid-task?" at a tier, kept per chat in the store (key coreAlert:<session id>), so a reload
// neither repeats the tier toast, re-raises a stood-down alert, nor asks the question again
type Answer = 'mid' | 'done'
type CoreAlert = { tier: number; isMemoryAlertRaised: boolean; advice?: { tier: number; answer: Answer } }
// The chat id the alert state was loaded for: /clear keeps the process but changes the id, so a
// new id loads that chat's own state instead of carrying the last chat's over
let alertLoadedFor: string | undefined
// Whether the core pane showed Compact when Claude last stood idle
let isCompactShown = false
// The question or advice the core pane showed when Claude last stood idle
let shownAnswer: Awaited<ReturnType<typeof coreAdvice>>
let advice: CoreAlert['advice']

async function loadCoreAlert($: EngineInterface) {
  const id = await $.session.id()
  if (alertLoadedFor === id) return
  const saved = (await $.store.get(`coreAlert:${id}`)) as Partial<CoreAlert> | undefined
  lastTier = saved?.tier ?? 0
  isMemoryAlertRaised = saved?.isMemoryAlertRaised ?? false
  advice = saved?.advice
  alertLoadedFor = id
}

async function saveCoreAlert($: EngineInterface) {
  await $.store.set(`coreAlert:${await $.session.id()}`, { tier: lastTier, isMemoryAlertRaised, advice } satisfies CoreAlert)
}

// From 70% the core asks once per tier whether the work is still mid-task: mid-task means
// compact and carry on, done means eject to a handoff and a fresh chat
export async function coreAdvice($: EngineInterface, tier: number): Promise<Answer | 'ask' | undefined> {
  if (tier < 2) return undefined
  await loadCoreAlert($)
  return advice?.tier === tier ? advice.answer : 'ask'
}

async function answerAdvice($: EngineInterface, answer: Answer) {
  await loadCoreAlert($)
  advice = { tier: tierOf(await read($, assimilation)), answer }
  await saveCoreAlert($)
  $.ui.invalidate('ui.render')
}

export const ADVICE_TEXT: Record<Answer, string> = {
  mid: 'Recommended: Compact, then carry on',
  done: 'Recommended: Eject core for a handoff and a fresh chat',
}

async function measure($: EngineInterface, percent: number | undefined, tokens: number | undefined, window?: number) {
  if (percent === undefined) return
  await loadCoreAlert($)
  const before: CoreAlert = { tier: lastTier, isMemoryAlertRaised, advice }
  contextTokens = tokens ?? contextTokens
  contextWindow = window ?? contextWindow
  await update($, assimilation, () => Math.round(percent))
  const tier = tierOf(percent)
  if (tier > lastTier) {
    $.ui.toast(`🟩 ${TIER_TEXT[tier]} · context ${Math.round(percent)}%`)
    if (tier === 3) void $.audio.speak('Your context will be assimilated. Resistance is futile.').catch(() => {})
  }
  lastTier = tier
  // Once the load falls below the tier an answer was given at (a compact, say), the answer is spent:
  // climbing back asks again
  if (advice && tier < advice.tier) advice = undefined
  // Raise once on crossing 90%, so a stand-down holds until context drops and climbs again
  if (percent >= 90 && !isMemoryAlertRaised) await setRedAlert($, true, 'Memory banks nearly assimilated')
  isMemoryAlertRaised = percent >= 90
  if (before.tier !== lastTier || before.isMemoryAlertRaised !== isMemoryAlertRaised || before.advice !== advice) {
    await saveCoreAlert($)
  }
}

export async function coreSessionStart($: EngineInterface) {
  await $.command.register({ name: 'warp-core', description: 'Open the warp core: context, activity, and Eject core for a handoff document', immediate: true }).catch(() => {})
  await $.command.register({ name: 'eject-core', description: 'Eject the warp core: Claude writes a handoff and continues the project in a new chat', immediate: true }).catch(() => {})
  const usage = await $.session.usage()
  await measure($, usage.context.percent, usage.context.tokens, usage.context.window)
}

export function registerCore(on: On) {
  on('session.measure', async ($, e, next) => {
    await measure($, e.context.percent, e.context.tokens, e.context.window)
    return next(e)
  })

  on('command.run', { command: 'warp-core' }, async $ => {
    const opened = await $.ui.open({ id: CORE_PANE, title: '⚛️ Warp core', closeOnEscape: true })
    return opened.isPlaced ? {} : { text: `Warp core pane not shown: ${opened.reason}` }
  })

  on('command.run', { command: 'eject-core' }, async $ => {
    ejectArmedUntil = (await $.clock.now()) + 6000
    await ejectCore($)
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: CORE_PANE }, async ($, e) => {
    const el = $.ui.resolve(e)
    const { Box, Text, Button } = el
    const percent = await read($, assimilation)
    const alert = await read($, redAlert)
    const now = await $.clock.now()
    const isArmed = now < ejectArmedUntil
    const isEjecting = now < ejectingUntil
    const tier = tierOf(percent)
    const isWorking = (await read($, activity)).turnStartedAt !== null
    // The question, its advice and the Compact button wait for the turn to end, so the pane never
    // grows mid-turn: during a turn they stay as the last idle draw left them
    if (!isWorking) isCompactShown = tier >= 2
    if (!isWorking) shownAnswer = await coreAdvice($, tier)
    const answer = shownAnswer
    const frameWidth = Math.max(220, Math.min(520, ((e.props.bodyColumns ?? 50) - 2) * 8))
    return (
      <Box flexDirection="column" rowGap={1} padding="sm">
        {alert.isOn && 'Svg' in el && <el.Svg source={redAlertSvg(alert.reason, frameWidth)} alt={`Red alert: ${alert.reason}`} height={34} isInteractive />}
        <Text backgroundColor={HEAD_COLOR} color={LCARS.ink} bold> MAIN ENGINEERING · WARP CORE </Text>
        <Box flexDirection="row" columnGap={2}>
          {'Svg' in el
            ? <el.Svg source={coreSvg(percent, isWorking, isEjecting)} alt={`Warp core at ${percent}% load`} width={80} height={200} isInteractive />
            : <Text color={LCARS.blue}>{'▮\n'.repeat(7)}</Text>}
          <Box flexDirection="column" rowGap={1}>
            <Text>Core load <Text color={tier >= 2 ? 'success' : '#9999ff'} bold>{percent}%</Text> of memory banks</Text>
            <Text dimColor>{contextTokens ? `${Math.round(contextTokens / 1000)}k tokens of dilithium` : 'Reading dilithium levels…'}</Text>
            <Text color={tier >= 2 ? 'success' : undefined} wrap="truncate">{tier ? `🟩 ${TIER_TEXT[tier]}` : 'No Borg on sensors'}</Text>
            {answer === 'ask' && <Text bold>Still mid-task, or done?</Text>}
            {answer === 'ask' && <Box flexDirection="row" columnGap={1}>
              <Button key="mid" label="Mid-task" hotkey="t" onPress={() => answerAdvice($, 'mid')} />
              <Button key="done" label="Done" hotkey="d" onPress={() => answerAdvice($, 'done')} />
            </Box>}
            {(answer === 'mid' || answer === 'done') && <Text color="success" bold>{ADVICE_TEXT[answer]}</Text>}
            {isEjecting && <Text color="error" bold>CORE EJECTED · writing the handoff</Text>}
            <Button
              key="eject"
              label={isArmed ? 'Confirm eject' : 'Eject core'}
              hotkey="e"
              variant={isArmed ? 'primary' : 'secondary'}
              onPress={() => ejectCore($)}
            />
            <Text dimColor italic>Eject writes a handoff and continues in a new chat. The project stays open.</Text>
            {isCompactShown && <Button key="compact" label="Compact memory" hotkey="m" onPress={async () => {
              $.ui.toast('🟩 Compacting before assimilation…')
              await $.session.compact()
            }} />}
          </Box>
        </Box>
      </Box>
    )
  })

  // The band above the prompt: the ship glides while Claude works; between turns it shows
  // red alert or the Borg, and nothing otherwise. Other plugins' bands and the engine's own
  // always show beneath it
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await isBandOn($))) return next(e)
    const el = $.ui.resolve(e)
    const beside = async (mine: RenderElement) => {
      const theirs = await next(e)
      return theirs ? <Box flexDirection="column">{mine}{theirs}</Box> : mine
    }
    const { Box, Text, Button } = el
    const alert = await read($, redAlert)
    const percent = await read($, assimilation)
    const tier = tierOf(percent)
    const width = Math.max(200, Math.min(900, ((e.props.bodyColumns ?? 60) - 2) * 8))

    if (e.props.isWorking) {
      const tint = alert.isOn ? 'red' : tier >= 2 ? 'borg' : 'none'
      return beside('Svg' in el
        // The frame gets the picture's own height: left to itself an interactive frame takes a tall
        // default and leaves dead space above and below the strip
        ? <el.Svg source={glideSvg(width, tint, await $.clock.now())} alt="An 8-bit starship gliding through stars" height={40} isInteractive />
        : <Text color={LCARS.violet}>{'  ·   ✦      ·  >=<   ·    ✦  '}</Text>)
    }
    if (alert.isOn) {
      return beside(
        <Box flexDirection="row" columnGap={1} alignItems="center">
          <Text backgroundColor={LCARS.red} color={LCARS.ink} bold> RED ALERT </Text>
          <Text color={LCARS.red}>{alert.reason}</Text>
          <Button key="band-stand-down" label="Stand down" plain onPress={() => setRedAlert($, false, '')} />
        </Box>
      )
    }
    if (tier >= 1) {
      const answer = await coreAdvice($, tier)
      return beside(
        <Box flexDirection="row" columnGap={1} alignItems="center" flexWrap="wrap">
          <Text backgroundColor={LCARS.green} color={LCARS.ink} bold> ASSIMILATION {percent}% </Text>
          <Text color="success">{TIER_TEXT[tier]}</Text>
          {answer === 'ask' && <Text bold>· Still mid-task?</Text>}
          {answer === 'ask' && <Button key="band-mid" label="Mid-task" plain onPress={() => answerAdvice($, 'mid')} />}
          {answer === 'ask' && <Button key="band-done" label="Done" plain onPress={() => answerAdvice($, 'done')} />}
          {answer === 'mid' && <Text bold>· Recommended:</Text>}
          {answer === 'mid' && <Button key="band-compact" label="Compact memory" plain onPress={() => $.session.compact()} />}
          {answer === 'done' && <Text bold>· Recommended:</Text>}
          {answer === 'done' && <Button key="band-eject" label="Eject core" plain onPress={() => ejectCore($)} />}
        </Box>
      )
    }
    return next(e)
  })
}
