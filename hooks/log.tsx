import type { EngineInterface, On } from 'claude-code'

import type { CrewMember, LogEntry, Mission } from '../types'
import { scanCrew } from './crew'
import { HUB_TEMPLATE, basename, isHubUrl, serial, stardate } from './shared'
import { HEAD_COLOR, LCARS } from './theme'
import { readVoyage } from './voyage'

// Captain's log quick capture, mission history, and the records tool the computer reads.
// The log and mission are kept in $.store per session (keys end in the session id);
// only the newest KEEP_SESSIONS sessions are kept whole; older sessions' entries move to the archive.

const LOG_PANE = 'starfleet-log'
const KEEP_SESSIONS = 20
const ARCHIVE_KEY = 'logArchive'
const ARCHIVE_MAX = 1000
// Keys kept per session: log:<id>, missions:<id>, voyage:<id>, lastPrompt:<id>, briefing:<id>,
// coreAlert:<id>, logDraft:<id>
const PER_SESSION = /^(log|missions|voyage|lastPrompt|briefing|coreAlert|logDraft):(.+)$/

let draftKey = 0


async function logKey($: EngineInterface) {
  return `log:${await $.session.id()}`
}

async function missionKey($: EngineInterface) {
  return `missions:${await $.session.id()}`
}

// Remember this session. A session past the newest KEEP_SESSIONS gives its log entries to the
// archive (never dropped unseen) and its mission, voyage and last order are cleared, so the store stays small
const trackLock = serial()

async function trackSession($: EngineInterface) {
  await trackLock(async () => {
    const id = await $.session.id()
    const saved = await $.store.get('logSessions')
    const ids = Array.isArray(saved) ? (saved as string[]) : []
    if (ids[0] === id) return
    const kept = [id, ...ids.filter(s => s !== id)].slice(0, KEEP_SESSIONS)
    await $.store.set('logSessions', kept)
    // Any session's keys not kept, including ones from before this tracking existed.
    // Cleanup never blocks the log write that called it
    const keys = await $.store.keys().catch(() => [] as string[])
    const stale = keys.filter(k => {
      const m = PER_SESSION.exec(k)
      return m && !kept.includes(m[2]!)
    })
    const archived = (await Promise.all(stale.filter(k => k.startsWith('log:')).map(async k => parseLog(await $.store.get(k))))).flat()
    if (archived.length) await archiveEntries($, archived)
    for (const k of stale) await $.store.delete(k)
  })
}

async function archiveEntries($: EngineInterface, entries: LogEntry[]) {
  const byId = new Map<string, LogEntry>()
  for (const e of [...entries, ...parseLog(await $.store.get(ARCHIVE_KEY))]) if (!byId.has(e.id)) byId.set(e.id, e)
  await $.store.set(ARCHIVE_KEY, [...byId.values()].sort((a, b) => b.at - a.at).slice(0, ARCHIVE_MAX))
}

export async function readLog($: EngineInterface): Promise<LogEntry[]> {
  return parseLog(await $.store.get(await logKey($)))
}

// Every kept session's entries and the archive, newest first: what the briefing reads
export async function readRecentLogs($: EngineInterface): Promise<LogEntry[]> {
  const saved = await $.store.get('logSessions')
  const ids = Array.isArray(saved) ? (saved as string[]) : []
  const logs = await Promise.all(ids.map(async id => parseLog(await $.store.get(`log:${id}`))))
  return [...logs.flat(), ...parseLog(await $.store.get(ARCHIVE_KEY))].sort((a, b) => b.at - a.at)
}

function parseLog(saved: unknown): LogEntry[] {
  if (!Array.isArray(saved)) return []
  // Entries from the first version had no id or time. The stardate is rebuilt from the time,
  // so entries saved in an older stardate format read (and sync) in today's
  return (saved as Partial<LogEntry>[]).map((e, i) => ({
    id: e.id ?? `old-${i}`,
    stardate: e.at ? stardate(e.at) : e.stardate ?? '—',
    text: e.text ?? '',
    at: e.at ?? 0,
    project: e.project ?? '',
  }))
}

// Entries recorded while there is no hub yet (store key hubPending): sent once a hub is set
type PendingEntry = { id: string; doc: Record<string, unknown> }
const PENDING_MAX = 200
const pendingLock = serial()

async function readPending($: EngineInterface): Promise<PendingEntry[]> {
  const saved = await $.store.get('hubPending')
  return Array.isArray(saved) ? (saved as PendingEntry[]) : []
}

// Hand over the held entries once, clearing them: the instruction that writes them to the hub
async function takePending($: EngineInterface): Promise<string | undefined> {
  const pending = await pendingLock(async () => {
    const held = await readPending($)
    if (held.length) await $.store.delete('hubPending')
    return held
  })
  if (!pending.length) return undefined
  return `Also add the captain's log entries recorded before the hub existed: with ArtifactData in one batch, set each in collection "log" (doc id = its id, data = its doc): ${JSON.stringify(pending)}`
}

// Write the hub's database straight through the ArtifactData tool, with no chat turn. False when the
// tool is missing, refused or errors, so the caller can fall back to asking Claude
async function writeHub($: EngineInterface, hub: string, writes: Record<string, unknown>[], consent: string): Promise<boolean> {
  try {
    const out = await $.tool.call({ tool: 'ArtifactData', action: 'batch', url: hub, writes, consent } as never) as { deny?: unknown; isError?: boolean; text?: string }
    if (!out.deny && !out.isError) return true
    await $.store.set('hubWriteError', { at: await $.clock.now(), deny: String(out.deny ?? ''), text: String(out.text ?? '').slice(0, 500) })
    return false
  } catch (error) {
    await $.store.set('hubWriteError', { at: await $.clock.now(), thrown: String(error).slice(0, 500) })
    return false
  }
}

// A hub doc's current version, or undefined when it isn't there or can't be read
async function hubVersion($: EngineInterface, hub: string, collection: string, id: string): Promise<number | undefined> {
  try {
    const out = await $.tool.call({ tool: 'ArtifactData', action: 'get', url: hub, collection, doc_id: id } as never) as { text?: string; isError?: boolean }
    const match = !out.isError && out.text?.match(/"version":(\d+)/)
    return match ? Number(match[1]) : undefined
  } catch {
    return undefined
  }
}

// Send one new entry to the hub right away, written straight to its database; a short Claude turn
// only if that fails. With no hub yet it is held, and goes when the hub is set
export async function sendEntryToHub($: EngineInterface, entry: LogEntry) {
  const hub = await hubUrl($)
  const doc = { stardate: entry.stardate, text: entry.text, at: entry.at, project: entry.project, session: await $.session.id() }
  if (!hub) {
    await pendingLock(async () => $.store.set('hubPending', [...(await readPending($)).filter(p => p.id !== entry.id), { id: entry.id, doc }].slice(-PENDING_MAX)))
    $.ui.toast('📓 Logged. It goes to your hub once you have one (Close mission sets it up).')
    return
  }
  if (await writeHub($, hub, [{ op: 'set', collection: 'log', doc_id: entry.id, data: doc }], 'The user pressed Record on the captain\'s log to save this note to their Starfleet Command hub.')) return
  void $.prompt.submit({ text: [
    `Add one captain's log entry to the Starfleet Command hub (${hub}).`,
    `With ArtifactData, set collection "log", doc id "${entry.id}", data ${JSON.stringify(doc)}.`,
    'Touch nothing else. Reply in one short line.',
  ].join('\n') }).catch(() => {})
}

export async function addLogEntry($: EngineInterface, text: string): Promise<LogEntry> {
  const now = await $.clock.now()
  // Track on every write too: after /clear the id changes with no session.start
  await trackSession($)
  const entry: LogEntry = { id: `log-${now}-${Math.random().toString(36).slice(2, 6)}`, stardate: stardate(now), text, at: now, project: basename(await $.session.cwd()) }
  await $.store.set(await logKey($), [entry, ...(await readLog($))].slice(0, 500))
  $.ui.invalidate('ui.render')
  return entry
}

// Ask first, naming the entry, with Keep as the default answer
async function confirmDeleteEntry($: EngineInterface, entry: LogEntry) {
  const gist = entry.text.length > 40 ? entry.text.slice(0, 39) + '…' : entry.text
  let answer: string | undefined
  try {
    answer = await $.ui.ask(`Delete the log entry "${gist}"?`, { header: 'Log', options: ['Keep', 'Delete entry'] })
  } catch {
    return // dismissed: nothing changes
  }
  if (answer === 'Delete entry') await deleteLogEntry($, entry.id)
}

// Delete here and on the hub: logDeleted keeps later syncs from bringing it back
export async function deleteLogEntry($: EngineInterface, id: string) {
  const entry = (await readLog($)).find(e => e.id === id)
  await $.store.set(await logKey($), (await readLog($)).filter(e => e.id !== id))
  await pendingLock(async () => {
    const held = await readPending($)
    if (held.some(p => p.id === id)) await $.store.set('hubPending', held.filter(p => p.id !== id))
  })
  $.ui.invalidate('ui.render')
  const hub = await hubUrl($)
  if (!hub) return
  const tombstone = { at: await $.clock.now(), project: entry?.project ?? '' }
  // The tombstone alone first, so a log doc that's already gone can't fail the batch
  const consent = 'The user pressed Delete entry on a captain\'s log note to remove it from their Starfleet Command hub.'
  if (await writeHub($, hub, [{ op: 'set', collection: 'logDeleted', doc_id: id, data: tombstone }], consent)) {
    // Deleting an existing doc needs its current version, read first
    const version = await hubVersion($, hub, 'log', id)
    if (version) await writeHub($, hub, [{ op: 'delete', collection: 'log', doc_id: id, if_version: version }], consent)
    return
  }
  void $.prompt.submit({ text: [
    `Delete one captain's log entry from the Starfleet Command hub (${hub}).`,
    `With ArtifactData in one batch: set collection "logDeleted", doc id "${id}", data ${JSON.stringify(tombstone)}, and delete collection "log", doc id "${id}" (skip the delete if that doc is not there).`,
    'Touch nothing else. Reply in one short line.',
  ].join('\n') }).catch(() => {})
}

async function readMissions($: EngineInterface): Promise<Mission[]> {
  const saved = await $.store.get(await missionKey($))
  // The stardate is rebuilt from the start time, as for log entries
  return Array.isArray(saved) ? (saved as Mission[]).map(m => (m.at ? { ...m, stardate: stardate(m.at) } : m)) : []
}

// One mission per session; change it in place
const missionLock = serial()

async function touchMission($: EngineInterface, fn: (m: Mission) => void) {
  await missionLock(() => writeMission($, fn))
}

async function writeMission($: EngineInterface, fn: (m: Mission) => void) {
  await trackSession($)
  const id = await $.session.id()
  const missions = await readMissions($)
  let mission = missions.find(m => m.id === id)
  if (!mission) {
    const now = await $.clock.now()
    const cwd = await $.session.cwd()
    mission = { id, stardate: stardate(now), at: now, project: basename(cwd), cwd, turns: 0, redAlerts: 0, handoffs: 0 }
    missions.unshift(mission)
  }
  fn(mission)
  await $.store.set(await missionKey($), missions.slice(0, 200))
}

export async function bumpMission($: EngineInterface, field: 'redAlerts' | 'handoffs') {
  await touchMission($, m => { m[field] += 1 })
}

// At each main turn's end: when the mission last moved, the model on duty, the context peak
export async function missionTurnComplete($: EngineInterface, contextPercent: number) {
  const now = await $.clock.now()
  const model = await $.session.model().catch(() => '')
  await touchMission($, m => {
    m.turns += 1
    m.endedAt = now
    if (model && !(m.models ?? []).includes(model)) m.models = [...(m.models ?? []), model]
    m.peakContext = Math.max(m.peakContext ?? 0, Math.round(contextPercent))
  })
}

// Every tool call that ran: tool counts, the skills loaded and the subagent types sent
export async function missionToolCall($: EngineInterface, tool: string, skill?: string, agent?: string) {
  await touchMission($, m => {
    m.tools = { ...m.tools, [tool]: (m.tools?.[tool] ?? 0) + 1 }
    if (skill && !(m.skills ?? []).includes(skill)) m.skills = [...(m.skills ?? []), skill]
    if (agent && !(m.agents ?? []).includes(agent)) m.agents = [...(m.agents ?? []), agent]
  })
}

// Plugins the mission drew on, read off its tool names (mcp__plugin_<plugin>_<server>__…),
// and the plugin prefix of skills and agents (<plugin>:<name>)
function pluginsOf(m: Mission): { plugins: string[]; mcpServers: string[] } {
  const plugins = new Set<string>(['starfleet'])
  const mcpServers = new Set<string>()
  for (const tool of Object.keys(m.tools ?? {})) {
    const plugin = /^mcp__plugin_([^_]+)_/.exec(tool)
    if (plugin) { plugins.add(plugin[1]!); continue }
    const server = /^mcp__([^_]+(?:_[^_]+)*?)__/.exec(tool)?.[1]
    // Connectors are named by an id; Claude's own app servers (ccd_*) are not plugins
    if (server && !/^ccd_/.test(server)) mcpServers.add(/^[0-9a-f-]{36}$/.test(server) ? 'claude.ai connector' : server)
  }
  for (const name of [...(m.skills ?? []), ...(m.agents ?? [])]) {
    const prefix = name.split(':')
    if (prefix.length > 1) plugins.add(prefix[0]!)
  }
  return { plugins: [...plugins], mcpServers: [...mcpServers] }
}

export async function sendClosure($: EngineInterface) {
  void $.prompt.submit({ text: await closurePrompt($, await $.clock.now()) }).catch(() => {})
  $.ui.toast('🖖 Filing the closure report with Starfleet Command…')
}

// The captain's own hub, published on the first sync or set with /hub <url>; none until then
export async function hubUrl($: EngineInterface): Promise<string | undefined> {
  const saved = await $.store.get('hubUrl')
  return typeof saved === 'string' && isHubUrl(saved) ? saved : undefined
}

export async function setHubUrl($: EngineInterface, url: string | undefined) {
  if (url) await $.store.set('hubUrl', url.replace(/\/$/, ''))
  else await $.store.delete('hubUrl')
}

// How a sync prompt opens: the saved hub, or steps that publish the captain's own hub first
async function hubOpening($: EngineInterface, what: string): Promise<string[]> {
  const hub = await hubUrl($)
  if (hub) return [`${what} (${hub}).`]
  return [
    'The captain has no Starfleet Command hub yet, so publish one first:',
    `- Publish the file ${$.plugin.root}/${HUB_TEMPLATE} as a new private Artifact, as it is (no redesign), with icon "star" and the capabilities assets, db and downloads, each {}.`,
    '- Call the starfleet_set_hub tool with the new artifact\'s URL.',
    `Then: ${what} (the hub you just published).`,
  ]
}

export async function syncPrompt($: EngineInterface): Promise<string> {
  return [
    ...(await hubOpening($, 'Sync the Starfleet Command hub artifact')),
    'Call the starfleet_records tool, then write its rows to the artifact database with ArtifactData in one batch:',
    '- collection "log": one doc per entry, doc id = entry id, fields { stardate, text, at, project }. First list collection "logDeleted": skip every entry whose id is a doc there (the captain deleted it in the hub)',
    '- collection "crew": one doc per crew member, doc id = the sprite key, fields { name, sprite, project, deck, status, order } where order is its position in the list',
    '- collection "missions": one doc per mission, doc id = mission id, with every field of the mission record as given (stardate, at, endedAt, project, cwd, turns, redAlerts, handoffs, models, warpCore, plugins, mcpServers, skills, agents, tools, files) plus three you write from this conversation:',
    '  summary: one line naming what the mission did, like "Built a clickable mission record for the hub"',
    '  report: 2 to 4 sentences on the project, the goal and how it ended (what works now, what is left)',
    '  steps: an array of 3 to 8 short strings, the steps taken in order',
    'Before writing a missions doc, read the existing one. If it has editedAt, the captain edited it by hand in the hub: write it with "update", not "set", and leave its summary, report, steps and editedAt as they are.',
    'For the mission\'s moments (screenshots, each with a local path): first read the existing missions doc; a moment whose path already has an entry there keeps its url. Upload each new one with the Artifact tool (publish, url = the hub, asset: true, file_paths = the new paths) and store moments as [{ at, caption, source, path, url }] in the order given. Never upload anything that is not in the moments list.',
    'Skip any mission whose id is a doc in collection "missionDeleted" (the captain deleted it in the hub). Write closed: true on every missions doc, and keep any closure and closedAt already on it.',
    'Add a field session = the records\' sessionId to every log and missions doc. Delete only log and missions docs whose session is that sessionId and whose ids are no longer in the records; leave other sessions\' docs alone. Delete crew docs whose ids are no longer in the records. Reply in one line with what was synced.',
  ].join('\n')
}

// The closure report: a full sync, then this session's mission finished off so the chat can be archived
export async function closurePrompt($: EngineInterface, now: number): Promise<string> {
  return [
    (await syncPrompt($)).replace(/Reply in one line with what was synced\.$/, ''),
    '',
    'This is the CLOSURE REPORT for this session\'s mission: the captain will archive this chat next, so write it from the whole conversation.',
    'Close mission is the only thing that ends the project. Start no new chat to continue it.',
    `On this session's missions doc also set: endedAt = ${now} (unless the records already give one), closedAt = ${now}, closed = true, and closure = {`,
    '  outcome: "complete", "partial" or "abandoned",',
    '  delivered: an array of 2 to 6 short strings, what works now that did not before,',
    '  openItems: an array of 0 to 5 short strings, what is unfinished, unverified or broken (empty if nothing),',
    '  nextStep: one line, the first thing to do when work resumes, or "None" ',
    '}. Make summary, report and steps final, covering the whole session, unless the doc has editedAt: then keep the captain\'s.',
    'Reply in two lines: the outcome and summary, then "Mission closed. Safe to archive this chat."',
  ].join('\n')
}

// The crew alone, sent after a rescan
// The ids and versions of every doc in one hub collection, or undefined when it can't be read
async function hubDocs($: EngineInterface, hub: string, collection: string): Promise<Map<string, number> | undefined> {
  try {
    const out = await $.tool.call({ tool: 'ArtifactData', action: 'list', url: hub, collection, query: { limit: 100 } } as never) as { text?: string; isError?: boolean }
    if (out.isError || out.text === undefined) return undefined
    const docs = new Map<string, number>()
    for (const m of out.text.matchAll(/\{"id":"([^"]+)".*?"version":(\d+)/g)) docs.set(m[1]!, Number(m[2]))
    return docs
  } catch {
    return undefined
  }
}

// Sync the crew roster to the hub straight through the ArtifactData tool, with no chat turn, the
// way captain's log entries go. False when it can't (no hub, no crew, a refused or failed call), so
// the caller can fall back to asking Claude
export async function syncCrewToHub($: EngineInterface): Promise<boolean> {
  const hub = await hubUrl($)
  if (!hub) return false
  // The sync deletes hub crew missing from the roster, so never sync an unscanned, empty one
  const crew = ((await $.store.get('crew')) ?? []) as CrewMember[]
  if (!crew.length) return false
  const existing = await hubDocs($, hub, 'crew')
  if (!existing) return false
  const pin = (id: string) => (existing.has(id) ? { if_version: existing.get(id) } : {})
  const writes: Record<string, unknown>[] = crew.map((c, order) => ({
    op: 'set', collection: 'crew', doc_id: c.sprite, ...pin(c.sprite),
    data: { name: c.name, sprite: c.sprite, project: c.project, deck: c.deck, status: c.status, order },
  }))
  const aboard = new Set(crew.map(c => c.sprite))
  for (const id of existing.keys()) if (!aboard.has(id)) writes.push({ op: 'delete', collection: 'crew', doc_id: id, ...pin(id) })
  return writeHub($, hub, writes, 'The user pressed Rescan + sync crew on the Starfleet console to update the crew roster on their Starfleet Command hub.')
}

export async function crewSyncPrompt($: EngineInterface): Promise<string> {
  return [
    ...(await hubOpening($, 'Sync the crew roster to the Starfleet Command hub artifact')),
    'Call the starfleet_records tool, then with ArtifactData in one batch write collection "crew": one doc per crew member, doc id = the sprite key, fields { name, sprite, project, deck, status, order } where order is its position in the list.',
    'Delete crew docs whose ids are no longer in the records. Touch no other collection. Reply in one line naming who is aboard.',
  ].join('\n')
}

// Answered by register.tsx's hook on mcp__starfleet__starfleet_records
export async function recordsJson($: EngineInterface): Promise<string> {
  // The sync deletes hub crew missing from these records, so never hand over an unscanned, empty roster
  let crew = ((await $.store.get('crew')) ?? []) as CrewMember[]
  if (!crew.length) {
    await scanCrew($).catch(() => {})
    crew = ((await $.store.get('crew')) ?? []) as CrewMember[]
  }
  return JSON.stringify({ hubUrl: (await hubUrl($)) ?? null, sessionId: await $.session.id(), log: await readLog($), crew, missions: await missionRecords($) }, null, 1)
}

// This session's missions with the voyage folded in: the warp core report and the files changed
async function missionRecords($: EngineInterface) {
  const v = await readVoyage($)
  return Promise.all((await readMissions($)).map(async m => ({
    ...m,
    ...pluginsOf(m),
    warpCore: { warpMs: v.warpMs, orders: v.orders, scans: v.scans, greenBuilds: v.greenBuilds, commits: v.commits, lastBuild: v.lastBuild, peakContext: m.peakContext ?? null, onDutyMs: (m.endedAt ?? m.at) - Math.min(m.at, v.startedAt) },
    files: v.files,
    moments: await momentsOf($, m),
  })))
}

// The screenshots the capturing-moments skill saved for this mission, from
// <project>/.claude/moments/moments.md: "- time | session | YYYY-MM-DD/nn-slug.png | source | caption | redacted:N"
async function momentsOf($: EngineInterface, m: Mission) {
  const dir = `${m.cwd ?? (await $.session.cwd())}/.claude/moments`
  let index = ''
  try {
    index = String(await $.fs.read(`${dir}/moments.md`))
  } catch {
    return []
  }
  return index.split('\n').filter(line => line.startsWith('- ')).map(line => line.slice(2).split(' | '))
    .filter(([, session, file]) => session === m.id && file)
    .map(([time, , file, source, caption]) => ({ at: Date.parse(time!) || 0, path: `${dir}/${file}`, source: source ?? '', caption: caption ?? '' }))
}

export async function logSessionStart($: EngineInterface) {
  await trackSession($)
  await $.command.register({ name: 'closure', description: 'Close this mission: write a closure report to the Starfleet Command hub so the chat can be archived', immediate: true })
  await $.command.register({ name: 'log', description: 'Captain’s log: /log <note> captures it now; /log alone opens the log', immediate: true, argumentHint: '<note>' })
  await $.tool.register({
    name: 'starfleet_records',
    description: 'Read the captain’s Starfleet records kept by the starfleet mod: this session’s captain’s log entries and mission, the crew roster (their code projects), mission history, and the hub artifact URL. Use when asked about the captain’s log, notes, crew, missions, or to sync the hub.',
    inputSchema: { type: 'object', properties: {} },
  })
  await $.tool.register({
    name: 'starfleet_set_hub',
    description: 'Save the URL of the captain’s Starfleet Command hub artifact (a claude.ai artifact link), so later syncs write to it. Call it right after publishing the hub during a sync.',
    inputSchema: { type: 'object', properties: { url: { type: 'string', description: 'The hub artifact’s claude.ai URL' } }, required: ['url'] },
  })
  await $.command.register({ name: 'hub', description: 'Starfleet Command hub: /hub shows its link, /hub <url> sets it, /hub clear forgets it', immediate: true, argumentHint: '<url> | clear' })
}

export function registerLog(on: On) {
  on('tool.call', { tool: 'mcp__starfleet__starfleet_set_hub' }, async ($, e) => {
    const url = String((e as { url?: unknown }).url ?? '').trim()
    if (!isHubUrl(url)) return { result: `Not saved: "${url}" is not a claude.ai artifact URL. Pass the URL the Artifact tool returned.` }
    await setHubUrl($, url)
    $.ui.invalidate('ui.render')
    const pending = await takePending($)
    return { result: [`Hub saved: ${url}`, pending].filter(Boolean).join('\n') }
  })

  on('command.run', { command: 'hub' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'clear') {
      await setHubUrl($, undefined)
      return { text: 'Hub forgotten. Your next Close mission publishes a new one. Notes you Record are held for it until then.' }
    }
    if (arg) {
      if (!isHubUrl(arg)) return { text: 'That is not a claude.ai artifact link. Use /hub https://claude.ai/artifact/…' }
      await setHubUrl($, arg)
      const pending = await takePending($)
      if (pending) void $.prompt.submit({ text: `Starfleet Command hub (${arg}). ${pending.replace(/^Also add/, 'Add')} Touch nothing else. Reply in one short line.` }).catch(() => {})
      return { text: `Starfleet Command hub set: ${arg}` }
    }
    const hub = await hubUrl($)
    return { text: hub ? `Starfleet Command hub: ${hub}` : 'No hub yet. Press Close mission in the /starfleet console and Claude publishes your own.' }
  })

  on('command.run', { command: 'closure' }, async $ => {
    await sendClosure($)
    return {}
  })

  on('command.run', { command: 'log' }, async ($, e) => {
    const text = e.args.trim()
    if (text) {
      const entry = await addLogEntry($, text)
      $.ui.toast(`📓 Logged at stardate ${entry.stardate}`)
      await sendEntryToHub($, entry)
      return {}
    }
    const opened = await $.ui.open({ id: LOG_PANE, title: '📓 Captain’s log', focus: true, closeOnEscape: true })
    return opened.isPlaced ? {} : { text: `Log pane not shown: ${opened.reason}` }
  })

  on('ui.render', { component: 'Pane', requestId: LOG_PANE }, async ($, e) => {
    const el = $.ui.resolve(e)
    const { Box, Text, Button, Link } = el
    const log = await readLog($)
    const hub = await hubUrl($)
    return (
      <Box flexDirection="column" rowGap={1} padding="sm">
        <Box flexDirection="row" columnGap={1}>
          <Text backgroundColor={HEAD_COLOR} color={LCARS.ink} bold> CAPTAIN’S LOG </Text>
          <Text color={LCARS.lilac}>Stardate {stardate(await $.clock.now())}</Text>
        </Box>
        {'Input' in el && (
          <el.Input
            key={'entry-' + draftKey}
            label="Log"
            value=""
            submitLabel="Record"
            autoFocus
            onSubmit={async value => {
              if (!value.trim()) return
              await sendEntryToHub($, await addLogEntry($, value.trim()))
              draftKey += 1
              $.ui.invalidate('ui.render')
            }}
          />
        )}
        <Box flexDirection="column">
          {log.length === 0 && <Text dimColor>No entries yet. Tip: type /log and a note at the prompt, from anywhere.</Text>}
          {log.slice(0, 12).map(entry => (
            <Box flexDirection="row" columnGap={1}>
              <Button key={'del-' + entry.id} label="Delete" plain dimColor onPress={() => confirmDeleteEntry($, entry)} />
              <Text color={LCARS.peach}>{entry.stardate}</Text>
              <Text>{entry.text}</Text>
              {entry.project && <Text dimColor>· {entry.project}</Text>}
            </Box>
          ))}
          {log.length > 12 && <Text dimColor>…and {log.length - 12} more in the hub</Text>}
        </Box>
        {hub ? <Link href={hub} label="Open Starfleet Command →" /> : <Text dimColor>No hub yet. Close mission in the console publishes your own Starfleet Command hub.</Text>}
      </Box>
    )
  })
}
