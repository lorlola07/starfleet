import { atom, read } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { CrewMember, Deck } from '../types'
import { CREW_PALETTE, SPRITES, SPRITE_ORDER, basename, deckOfTool, errText, pixels, serial } from './shared'
import { LCARS } from './theme'

// Your code projects as an 8-bit crew. Each stands on the deck that matches its state, and
// this session's project follows Claude to whichever deck is doing the work right now.

const CREW_PANE = 'starfleet-crew'
const activity = atom({ plugin: 'starfleet', key: 'activity' } as const, { current: null, turnStartedAt: null, turnCalls: 0, recent: [] })

export const DECKS: { id: Deck; label: string; color: string }[] = [
  { id: 'bridge', label: 'DECK 1 · BRIDGE', color: '#ff9c4b' },
  { id: 'science', label: 'DECK 4 · SENSORS AND LIBRARY', color: '#c9a0dc' },
  { id: 'engineering', label: 'DECK 12 · ENGINEERING', color: '#9aa9ff' },
  { id: 'sickbay', label: 'DECK 9 · SICKBAY', color: '#ff5555' },
  { id: 'quarters', label: 'DECK 8 · CREW QUARTERS', color: '#8c8a96' },
]
export const DECK_H = 46
const SLOT_W = 58

// Module state: the roster, and where each sprite was last drawn (so it walks from there)
let roster: Omit<CrewMember, 'deck' | 'isCurrent'>[] = []
let baseDecks: Record<string, Deck> = {}
let lastScan = 0
// Why the archive check could not run on the last scan, shown in the pane; undefined when it ran
let archiveProblem: string | undefined
// Where each sprite stands now. A sprite moves only when its next deck is known; otherwise it stays
const placed: Record<string, Deck> = {}
// When the latest turn began, so a scan from before it is not trusted for this session's project
let latestTurnStart = 0
const walkFrom: Record<string, { x: number; y: number }> = {}
const walkTo: Record<string, { x: number; y: number }> = {}

// ~/.claude/projects names a project's path with every / and . turned into -; rebuild it.
// A dash may also be a real one (my-space), so try each split and back up on a dead end
async function decodeProjectDir($: EngineInterface, name: string): Promise<string | undefined> {
  const parts = name.replace(/^-/, '').split('-')
  async function walk(path: string, i: number): Promise<string | undefined> {
    if (i >= parts.length) return path
    // Two dashes in a row were "/." : a dot folder such as .claude
    const isDot = parts[i] === ''
    const start = isDot ? i + 1 : i
    for (let j = start; j < parts.length; j++) {
      const candidate = `${path}/${isDot ? '.' : ''}${parts.slice(start, j + 1).join('-')}`
      if (!(await $.fs.exists(candidate))) continue
      const found = await walk(candidate, j + 1)
      if (found) return found
    }
    return undefined
  }
  return walk('', 0)
}

// ── Cloud crew: projects worked on in cloud sessions leave no folder here, so the captain
// picks their GitHub repos by hand (store key cloudCrew, "owner/repo" each) ──

const CLOUD_PREFIX = 'github:'
const CLOUD_CREW_TOOL = 'mcp__starfleet__starfleet_cloud_crew'
// Recent repos offered in the picker, read when the crew pane opens
let recentRepos: { repo: string; pushedAt: number }[] = []
let repoProblem: string | undefined

// gh from the PATH, or Homebrew's when the app's PATH leaves it out. Only a gh that won't start
// moves on to the next path: a gh that ran and failed (signed out, no such repo) is the answer
async function gh($: EngineInterface, args: string[]): Promise<string> {
  let lastError = 'gh not found'
  for (const bin of ['gh', '/opt/homebrew/bin/gh', '/usr/local/bin/gh']) {
    let run
    try {
      run = await $.process.run([bin, ...args], { timeoutMs: 8000 })
    } catch (err) {
      lastError = errText(err)
      continue
    }
    if (run.exitCode === 0) return run.stdout
    throw new Error(run.stderr.trim().slice(0, 160) || `gh exited ${run.exitCode}`)
  }
  throw new Error(lastError)
}

export async function cloudPicks($: EngineInterface): Promise<string[]> {
  const saved = await $.store.get('cloudCrew')
  return Array.isArray(saved) ? (saved as string[]) : []
}

// Guards the cloudCrew picks; a scan reads them but never writes them, so it takes its own lock
const picksLock = serial()
const MAX_CLOUD = 4

export async function toggleCloudPick($: EngineInterface, repo: string) {
  await picksLock(async () => {
    const picks = await cloudPicks($)
    if (!picks.includes(repo) && picks.length >= MAX_CLOUD) {
      $.ui.toast(`Cloud crew is full (${MAX_CLOUD}). Untick one first.`)
      return
    }
    await $.store.set('cloudCrew', picks.includes(repo) ? picks.filter(r => r !== repo) : [...picks, repo])
  })
}

export async function loadRecentRepos($: EngineInterface) {
  try {
    const rows = JSON.parse(await gh($, ['repo', 'list', '--limit', '30', '--json', 'nameWithOwner,pushedAt'])) as { nameWithOwner: string; pushedAt: string }[]
    recentRepos = rows.map(r => ({ repo: r.nameWithOwner, pushedAt: Date.parse(r.pushedAt) || 0 })).sort((a, b) => b.pushedAt - a.pushedAt).slice(0, 10)
    repoProblem = undefined
  } catch (err) {
    repoProblem = errText(err)
  }
}

function ago(ms: number): string {
  const m = Math.floor(ms / 60000)
  return m < 60 ? `${Math.max(1, m)}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`
}

// One picked repo as a crew member: on the bridge if pushed today, else in quarters
async function cloudMember($: EngineInterface, repo: string, now: number) {
  let pushedAt = 0
  try {
    pushedAt = Date.parse((JSON.parse(await gh($, ['repo', 'view', repo, '--json', 'pushedAt'])) as { pushedAt: string }).pushedAt) || 0
  } catch {
    // offline or gh signed out: keep them aboard with no push time
  }
  const deck: Deck = pushedAt && now - pushedAt < 86400000 ? 'bridge' : 'quarters'
  const status = pushedAt ? `Cloud · pushed ${ago(now - pushedAt)} ago` : 'Cloud · no word from GitHub'
  return { member: { path: CLOUD_PREFIX + repo, project: repo.split('/').pop() ?? repo, sprite: '', name: 'Crew', status }, deck }
}

// How many sessions one archive check reads from the app
const SESSION_LIMIT = 1000

// Project folders whose app sessions are all archived. Asks the desktop app's session list;
// outside the app (no such server) nothing counts as archived
async function archivedProjects($: EngineInterface): Promise<Set<string>> {
  const archived = new Set<string>()
  archiveProblem = undefined
  try {
    const result = await $.mcp.call('ccd_session_mgmt', 'list_sessions', { include_archived: true, limit: SESSION_LIMIT })
    // Content blocks are not a tagged union, so read .text itself rather than narrow on type
    const text = result.content.find(c => c.type === 'text')?.text
    if (result.isError || text === undefined) {
      archiveProblem = text?.slice(0, 160) ?? 'session list returned no text'
      return archived
    }
    const sessions = JSON.parse(text) as { cwd?: string; isArchived?: boolean }[]
    // A full page may leave out older live sessions: hide nothing rather than guess
    if (sessions.length >= SESSION_LIMIT) {
      archiveProblem = `over ${SESSION_LIMIT} sessions to check`
      return archived
    }
    const live = new Set<string>()
    for (const s of sessions) {
      // A worktree session counts for the project it was cut from
      const cwd = s.cwd?.replace(/\/\.claude\/worktrees\/.*$/, '')
      if (cwd) (s.isArchived ? archived : live).add(cwd)
    }
    for (const cwd of live) archived.delete(cwd)
  } catch (err) {
    // not in the desktop app, or its list could not be read
    archiveProblem = errText(err)
  }
  return archived
}

// One scan at a time; calls made while one waits join it, so an older scan never lands after a newer one
const scanLock = serial()
let queuedScan: Promise<void> | undefined

// A sprite's shirt color: the palette letter at the start of its chest row
function shirtOf(key: string | undefined): string | undefined {
  return key ? SPRITES[key]?.rows[6]?.[0] : undefined
}

export function scanCrew($: EngineInterface): Promise<void> {
  return (queuedScan ??= scanLock(() => {
    queuedScan = undefined
    return runScan($)
  }))
}

async function runScan($: EngineInterface) {
  const home = await $.env.get('HOME')
  if (!home) return
  const cwd = await $.session.cwd()
  let entries: { name: string; mtimeMs: number }[] = []
  try {
    // fs.list gives 0 for a folder's mtimeMs; fs.stat has the real one
    const dirs = (await $.fs.list(`${home}/.claude/projects`)).filter(x => x.kind === 'dir')
    entries = await Promise.all(dirs.map(async x => ({
      name: x.name,
      mtimeMs: await $.fs.stat(`${home}/.claude/projects/${x.name}`).then(st => st.mtimeMs, () => 0),
    })))
  } catch {
    entries = []
  }
  entries.sort((a, b) => b.mtimeMs - a.mtimeMs)
  const health = ((await $.store.get('health')) ?? {}) as Record<string, boolean>
  const assigned = ((await $.store.get('crewAssign')) ?? {}) as Record<string, string>
  const archived = await archivedProjects($)
  const now = await $.clock.now()
  const found: typeof roster = []
  const decks: Record<string, Deck> = {}
  const seen = new Set<string>()
  const picks = await cloudPicks($)
  const aboardLocal: { path: string; mtimeMs: number }[] = []
  for (const entry of entries) {
    if (aboardLocal.length >= 8 - picks.length) break
    const path = await decodeProjectDir($, entry.name)
    if (!path || seen.has(path) || /\/\.claude\/|\/tmp\/|\/private\/|\/Library\//.test(path) || path === home) continue
    // Archived in the app: off the decks (this session's project always stays)
    if (archived.has(path) && path !== cwd) continue
    seen.add(path)
    aboardLocal.push({ path, mtimeMs: entry.mtimeMs })
  }
  // Uncommitted changes, checked for every project at once
  const changeCounts = await Promise.all(aboardLocal.map(async ({ path }) => {
    try {
      const git = await $.process.run(['git', '-C', path, 'status', '--porcelain'], { timeoutMs: 5000 })
      return git.exitCode === 0 ? git.stdout.split('\n').filter(Boolean).length : 0
    } catch {
      return 0 // not a git repository, or git missing: no engineering work to show
    }
  }))
  for (const [i, entry] of aboardLocal.entries()) {
    const path = entry.path
    const changes = changeCounts[i]!
    const isDirty = changes > 0
    const isActiveToday = now - entry.mtimeMs < 86400000
    const deck: Deck = health[path] ? 'sickbay' : isDirty ? 'engineering' : isActiveToday ? 'bridge' : 'quarters'
    const days = Math.floor((now - entry.mtimeMs) / 86400000)
    const status = health[path] ? 'Diagnostics failing' : isDirty ? `${changes} uncommitted change${changes > 1 ? 's' : ''}` : isActiveToday ? 'On duty today' : `Shore leave ${days}d`
    found.push({ path, project: basename(path), sprite: '', name: 'Crew', status })
    decks[path] = path === cwd && deck === 'quarters' ? 'bridge' : deck
  }
  for (const { member, deck } of await Promise.all(picks.map(repo => cloudMember($, repo, now)))) {
    found.push(member)
    decks[member.path] = deck
  }
  // Free the sprites of projects no longer aboard (archived, moved, or past the newest 8),
  // then give each newcomer a free one; those aboard keep theirs. No two neighbors in the
  // line-up wear the same shirt color: a clash swaps the later one for a free sprite that fits
  const aboard = new Set(found.map(c => c.path))
  for (const path of Object.keys(assigned)) if (!aboard.has(path)) delete assigned[path]
  for (const [i, c] of found.entries()) {
    const prev = i > 0 ? shirtOf(assigned[found[i - 1]!.path]) : undefined
    if (assigned[c.path] && shirtOf(assigned[c.path]) === prev) {
      const swap = SPRITE_ORDER.find(k => !Object.values(assigned).includes(k) && shirtOf(k) !== prev)
      if (swap) assigned[c.path] = swap
    }
    if (!assigned[c.path]) {
      const free = SPRITE_ORDER.filter(k => !Object.values(assigned).includes(k))
      assigned[c.path] = free.find(k => shirtOf(k) !== prev) ?? free[0] ?? SPRITE_ORDER[i % SPRITE_ORDER.length]!
    }
    c.sprite = assigned[c.path]!
    c.name = SPRITES[c.sprite]?.name ?? 'Crew'
  }
  roster = found
  baseDecks = decks
  lastScan = now
  await $.store.set('crewAssign', assigned)
  await $.store.set('crew', found.map((c, order) => ({ ...c, deck: decks[c.path], order })))
}

// ── Live decks shared between chats: each chat posts where its project's sprite stands in a
// small file under ~/.claude/starfleet-live (files, not $.store, so chats never overwrite each
// other); every chat reads them so all consoles show the same crew at the same moment ──

const LIVE_FRESH_MS = 2 * 60 * 1000
let livePosted: { deck: Deck | null; at: number } = { deck: null, at: 0 }
let liveCache: { at: number; decks: Record<string, Deck> } = { at: 0, decks: {} }

async function liveDir($: EngineInterface) {
  return `${await $.env.get('HOME')}/.claude/starfleet-live`
}
const liveName = (path: string) => path.replace(/[^a-zA-Z0-9]/g, '-') + '.json'

// Post this chat's deck: on a change, or every 30s to stay fresh; null when the turn ends
export async function postLiveDeck($: EngineInterface, deck: Deck | null) {
  const now = await $.clock.now()
  if (deck === livePosted.deck && now - livePosted.at < 30000) return
  livePosted = { deck, at: now }
  try {
    const path = await $.session.cwd()
    await $.fs.write(`${await liveDir($)}/${liveName(path)}`, JSON.stringify({ path, deck, at: now }))
  } catch {
    // no shared folder: other chats keep their own guess
  }
}

// Other chats' fresh posts, read at most every 5s
async function liveDecks($: EngineInterface): Promise<Record<string, Deck>> {
  const now = await $.clock.now()
  if (now - liveCache.at < 5000) return liveCache.decks
  const decks: Record<string, Deck> = {}
  try {
    const dir = await liveDir($)
    for (const f of (await $.fs.list(dir)).filter(x => x.kind === 'file' && x.name.endsWith('.json'))) {
      try {
        const post = JSON.parse(String(await $.fs.read(`${dir}/${f.name}`))) as { path?: string; deck?: Deck | null; at?: number }
        if (post.path && post.deck && post.at && now - post.at < LIVE_FRESH_MS) decks[post.path] = post.deck
      } catch {
        // a half-written or old file: skip it
      }
    }
  } catch {
    // no posts yet
  }
  liveCache = { at: now, decks }
  return decks
}

export async function crewNow($: EngineInterface): Promise<CrewMember[]> {
  const live = await liveDecks($)
  const cwd = await $.session.cwd()
  const a = await read($, activity)
  const isInTurn = a.turnStartedAt !== null
  if (isInTurn) latestTurnStart = Math.max(latestTurnStart, a.turnStartedAt!)
  return roster.map(c => {
    const isCurrent = c.path === cwd
    // Mid-turn, this session's sprite follows the tool running now and holds still between tools.
    // After the turn it waits for a scan taken since the turn began before it walks anywhere
    const next: Deck | undefined = !isCurrent ? live[c.path] ?? baseDecks[c.path]
      : isInTurn ? (a.current ? deckOfTool(a.current.tool) : undefined)
      : lastScan >= latestTurnStart ? baseDecks[c.path] : undefined
    const deck = next ?? placed[c.path] ?? baseDecks[c.path] ?? 'quarters'
    placed[c.path] = deck
    return { ...c, deck, isCurrent }
  })
}

export function crewSvg(crew: CrewMember[], width: number): string {
  const height = DECKS.length * DECK_H + 8
  const slots: Record<string, number> = {}
  let sprites = ''
  let style = ''
  crew.forEach((c, i) => {
    const row = DECKS.findIndex(d => d.id === c.deck)
    const slot = (slots[c.deck] = (slots[c.deck] ?? 0) + 1) - 1
    const to = { x: 14 + slot * SLOT_W, y: 4 + row * DECK_H + 3 }
    const prev = walkTo[c.sprite]
    if (!prev || prev.x !== to.x || prev.y !== to.y) {
      walkFrom[c.sprite] = prev ?? to
      walkTo[c.sprite] = to
    }
    const from = walkFrom[c.sprite]!
    const art = pixels(SPRITES[c.sprite]?.rows ?? SPRITES.data!.rows, CREW_PALETTE, 3)
    style += `@keyframes w${i}{0%{transform:translate(${from.x}px,${from.y}px)}100%{transform:translate(${to.x}px,${to.y}px)}}.s${i}{transform:translate(${to.x}px,${to.y}px);animation:w${i} 1.8s steps(9) forwards}`
    sprites += `<g class="s${i}"><g class="${c.isCurrent ? 'hop' : 'idle'}" style="animation-delay:${(i % 4) * 0.2}s">${art}</g>`
      + `<text x="12" y="34" text-anchor="middle" font-family="Space Mono,monospace" font-size="7" fill="#f1ece4">${c.project.slice(0, 10).replace(/[<&>]/g, '')}</text>`
      + (c.isCurrent ? '<rect x="2" y="-5" width="20" height="2" fill="#ffcc33" class="hop"/>' : '')
      + '</g>'
  })
  const decks = DECKS.map((d, i) =>
    `<rect x="0" y="${4 + i * DECK_H}" width="${width}" height="${DECK_H - 4}" rx="4" fill="#12121c"/>`
    + `<rect x="0" y="${4 + i * DECK_H}" width="6" height="${DECK_H - 4}" fill="${d.color}"/>`
    + `<text x="${width - 8}" y="${16 + i * DECK_H}" text-anchor="end" font-family="Antonio,Arial Narrow,sans-serif" font-size="10" letter-spacing="1" fill="${d.color}">${d.label}</text>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" shape-rendering="crispEdges">
<style>${style}
@keyframes idle{0%,100%{transform:translateY(0)}50%{transform:translateY(-1px)}}
@keyframes hop{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
.idle{animation:idle 1.6s steps(2) infinite}.hop{animation:hop .5s steps(2) infinite}
@media (prefers-reduced-motion:reduce){[class^=s],.idle,.hop{animation:none!important}}
</style>
<rect width="${width}" height="${height}" rx="8" fill="#07070c"/>${decks}${sprites}
</svg>`
}

// Set a cloud repo aboard or ashore by name, for when the crew pane can't be opened
export async function setCloudPick($: EngineInterface, repo: string, isAboard: boolean): Promise<string> {
  // The picks change under their lock; the rescan runs after it is released (it has its own)
  const answer = await picksLock(async () => {
    const picks = await cloudPicks($)
    const match = picks.find(r => r.toLowerCase() === repo.toLowerCase()) ?? repo
    if (isAboard === picks.includes(match)) return { match, changed: false, text: `${match} is already ${isAboard ? 'aboard' : 'ashore'}. Cloud crew: ${picks.join(', ') || 'none'}` }
    if (isAboard && picks.length >= MAX_CLOUD) return { match, changed: false, text: `Cloud crew is full (${MAX_CLOUD}): ${picks.join(', ')}. Send one ashore first.` }
    await $.store.set('cloudCrew', isAboard ? [...picks, match] : picks.filter(r => r !== match))
    return { match, changed: true, text: '' }
  })
  if (!answer.changed) return answer.text
  await scanCrew($)
  $.ui.invalidate('ui.render')
  const now = await cloudPicks($)
  return `${answer.match} is now ${isAboard ? 'aboard' : 'ashore'}. Cloud crew: ${now.join(', ') || 'none'}`
}

let crewTick: { cancel(): void } | undefined

export async function crewSessionStart($: EngineInterface) {
  // Redraw every 15s so other chats' live decks show up between this chat's turns
  crewTick?.cancel()
  crewTick = $.clock.every(15000, () => $.ui.invalidate('ui.render'))
  await $.tool.register({
    name: 'starfleet_cloud_crew',
    description: 'Bring a cloud project (a GitHub repo, "owner/repo") aboard the Starfleet crew or send it ashore. Use when the captain archives a cloud session or asks to add or remove cloud crew.',
    inputSchema: { type: 'object', properties: { repo: { type: 'string', description: 'GitHub repo as owner/repo' }, aboard: { type: 'boolean', description: 'true to bring aboard, false to send ashore' } }, required: ['repo', 'aboard'] },
  })
  await $.command.register({ name: 'crew', description: 'Open the crew decks: your projects as 8-bit crew members, and pick cloud repos to bring aboard', immediate: true })
}

export async function crewTurnComplete($: EngineInterface) {
  // Every turn end rescans, so this session's sprite learns its next deck right away
  if (!roster.length) return
  await scanCrew($)
  $.ui.invalidate('ui.render')
}

export function registerCrew(on: On) {
  // @ts-expect-error TS2589: tsc gives up inferring this matcher's event type ("excessively deep"); the hook runs fine
  on('tool.call', { tool: CLOUD_CREW_TOOL }, async ($: EngineInterface, e: { repo?: unknown; aboard?: unknown }) => {
    if (typeof e.repo !== 'string' || !e.repo || typeof e.aboard !== 'boolean') return { result: 'Give repo (owner/repo) and aboard (true or false).' }
    return { result: await setCloudPick($, e.repo, e.aboard) }
  })

  on('command.run', { command: 'crew' }, async $ => {
    await scanCrew($)
    void loadRecentRepos($).then(() => $.ui.invalidate('ui.render'))
    const opened = await $.ui.open({ id: CREW_PANE, title: '👥 Crew decks', closeOnEscape: true })
    return opened.isPlaced ? {} : { text: `Crew pane not shown: ${opened.reason}` }
  })

  on('ui.render', { component: 'Pane', requestId: CREW_PANE }, async ($, e) => {
    const el = $.ui.resolve(e)
    const { Box, Text, Button } = el
    const crew = await crewNow($)
    const picks = await cloudPicks($)
    const now = await $.clock.now()
    const width = Math.max(260, Math.min(560, ((e.props.bodyColumns ?? 50) - 2) * 8))
    return (
      <Box flexDirection="column" rowGap={1} padding="sm">
        <Text backgroundColor={LCARS.blue} color={LCARS.ink} bold> CREW DECKS · {crew.length} ABOARD </Text>
        {crew.length === 0 && <Text dimColor>Scanning for crew… no projects found in ~/.claude/projects yet.</Text>}
        {crew.length > 0 && ('Svg' in el
          ? <el.Svg source={crewSvg(crew, width)} alt={crew.map(c => `${c.name} (${c.project}) on ${c.deck}`).join(', ')} width={width} height={DECKS.length * DECK_H + 8} isInteractive />
          : null)}
        <Box flexDirection="column">
          {crew.map(c => (
            <Text>
              <Text color={LCARS.peach} bold>{c.name.padEnd(8)}</Text> {c.project.padEnd(18)} <Text color={LCARS.lilac}>{c.deck.padEnd(12)}</Text> <Text dimColor>{c.isCurrent ? 'this session · ' : ''}{c.status}</Text>
            </Text>
          ))}
        </Box>
        {archiveProblem && <Text dimColor>Archived projects not hidden: {archiveProblem}</Text>}
        <Button key="rescan" label="Rescan crew (r)" hotkey="r" onPress={async () => { await scanCrew($); $.ui.invalidate('ui.render') }} />
        <Text backgroundColor={LCARS.lilac} color={LCARS.ink} bold> CLOUD CREW · PICK UP TO 4 REPOS </Text>
        <Text dimColor>Cloud sessions leave no folder on this Mac. Pick the repos they work in to bring them aboard.</Text>
        {repoProblem && <Text dimColor>GitHub not reachable: {repoProblem}</Text>}
        {!repoProblem && recentRepos.length === 0 && <Text dimColor>Reading your GitHub repos…</Text>}
        <Box flexDirection="row" columnGap={2} flexWrap="wrap">
          {recentRepos.map(r => {
            const isPicked = picks.includes(r.repo)
            return <Button key={`cloud-${r.repo}`} label={`${isPicked ? '☑' : '☐'} ${r.repo.split('/').pop()} · ${ago(now - r.pushedAt)}`} {...(isPicked ? {} : { plain: true as const })} onPress={async () => {
              await toggleCloudPick($, r.repo)
              await scanCrew($)
              $.ui.invalidate('ui.render')
            }} />
          })}
        </Box>
      </Box>
    )
  })
}
