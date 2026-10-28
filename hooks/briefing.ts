import type { EngineInterface } from 'claude-code'

import { readRecentLogs } from './log'
import { isAiOn } from './prefs'
import { basename } from './shared'

// The mission briefing: where this project left off, built once per session from the newest
// handoff document (.claude/handoffs) and this project's recent captain's log entries from
// any kept session.

export type Briefing = { status: 'none' | 'loading' | 'ready'; lines: string[]; source: string }

let briefing: Briefing = { status: 'none', lines: [], source: '' }
// Acknowledged is kept per chat in the store (key briefing:<session id>), so a reload or a
// reopened console doesn't bring the briefing back; dismissedFor saves re-reading it each redraw
let dismissedFor: string | undefined

async function isDismissed($: EngineInterface): Promise<boolean> {
  const id = await $.session.id()
  if (dismissedFor === id) return true
  if ((await $.store.get(`briefing:${id}`)) !== true) return false
  dismissedFor = id
  return true
}

export async function currentBriefing($: EngineInterface): Promise<Briefing & { isDismissed: boolean }> {
  return { ...briefing, isDismissed: await isDismissed($) }
}

export async function dismissBriefing($: EngineInterface) {
  const id = await $.session.id()
  dismissedFor = id
  await $.store.set(`briefing:${id}`, true)
}

async function newestHandoff($: EngineInterface): Promise<{ name: string; text: string } | undefined> {
  try {
    const files = (await $.fs.list('.claude/handoffs')).filter(f => f.kind === 'file' && f.name.endsWith('.md'))
    const newest = [...files].sort((a, b) => b.mtimeMs - a.mtimeMs)[0]
    if (!newest) return undefined
    const text = await $.fs.read(`.claude/handoffs/${newest.name}`)
    return { name: newest.name, text: text.slice(0, 6000) }
  } catch {
    return undefined
  }
}

const SYSTEM = `You write a starship mission briefing from a project's handoff notes and log entries.
Reply with exactly three short lines, no preamble, no markdown:
LEFT OFF: <where the work stands, under 14 words>
STANDING ORDER: <the single next step, under 14 words>
WATCH FOR: <one open risk or question, under 14 words, or "Nothing flagged">
Plain technical wording. Keep real file names and commands.`

export async function buildBriefing($: EngineInterface) {
  if (briefing.status !== 'none' || (await isDismissed($))) return
  briefing = { status: 'loading', lines: [], source: '' }
  $.ui.invalidate('ui.render')
  try {
    await composeBriefing($)
  } catch {
    // Back to none, so the next press of Mission briefing tries again instead of loading forever
    briefing = { status: 'none', lines: [], source: '' }
    $.ui.invalidate('ui.render')
  }
}

async function composeBriefing($: EngineInterface) {
  const project = basename(await $.session.cwd())
  const handoff = await newestHandoff($)
  const log = (await readRecentLogs($)).filter(e => e.project === project).slice(0, 5)
  if (!handoff && log.length === 0) {
    briefing = { status: 'ready', lines: ['No prior missions on record for this project.', 'STANDING ORDER: Await the captain’s orders.'], source: 'ship’s records' }
    $.ui.invalidate('ui.render')
    return
  }
  const notes = [
    handoff ? `HANDOFF (${handoff.name}):\n${handoff.text}` : '',
    log.length ? `LOG ENTRIES:\n${log.map(e => `${e.stardate}: ${e.text}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n')
  // With AI summaries off, the briefing is the log as written and nothing leaves for a model
  const reply = (await isAiOn($)) ? await $.model.complete({ model: 'haiku', system: SYSTEM, prompt: notes, maxTokens: 200 }) : { isAnswered: false as const, text: '' }
  const asWritten = log.length
    ? log.slice(0, 3).map(e => `${e.stardate}: ${e.text}`)
    : (handoff?.text ?? '').split('\n').map(l => l.trim()).filter(Boolean).slice(0, 3)
  const lines = reply.isAnswered ? reply.text.trim().split('\n').map(l => l.trim()).filter(Boolean).slice(0, 3) : asWritten
  briefing = { status: 'ready', lines, source: handoff ? handoff.name : 'captain’s log' }
  $.ui.invalidate('ui.render')
}
