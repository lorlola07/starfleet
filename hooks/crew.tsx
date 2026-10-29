import { atom, read } from 'claude-code'
import type { EngineInterface, On, RenderElement } from 'claude-code'

import type { CrewMember, Deck } from '../types'
import { CREW_MAX, CREW_PALETTE, RETIRED_SPRITES, SPRITES, SPRITE_ORDER, basename, errText, pixels, projectOf, serial, taggedTitle, untaggedTitle } from './shared'
import { FILL_WIDTH, HEAD_COLOR, LCARS, chirp } from './theme'

// Rescan the crew. The hub keeps no roster: each mission report there carries its crew member
async function rescan($: EngineInterface) {
  void chirp($)
  await scanCrew($)
  $.ui.invalidate('ui.render')
  $.ui.toast('📡 Crew rescanned.')
}

// Your code projects as an 8-bit crew. Each stands on the deck that matches its state, and
// this session's project follows Claude to whichever deck is doing the work right now.

const CREW_PANE = 'starfleet-crew'
const activity = atom({ plugin: 'starfleet', key: 'activity' } as const, { current: null, turnStartedAt: null, turnCalls: 0, recent: [] })

export const DECKS: { id: Deck; label: string; color: string }[] = [
  { id: 'bridge', label: 'DECK 1 · BRIDGE', color: '#ff9c4b' },
  { id: 'science', label: 'DECK 2 · SENSORS AND LIBRARY', color: '#c9a0dc' },
  { id: 'engineering', label: 'DECK 3 · ENGINEERING', color: '#9aa9ff' },
  { id: 'sickbay', label: 'DECK 4 · SICKBAY', color: '#ff5555' },
  { id: 'quarters', label: 'DECK 5 · CREW QUARTERS', color: '#8c8a96' },
]
export const DECK_H = 62
const SLOT_W = 66

// Module state: the roster, and where each sprite was last drawn (so it walks from there)
let roster: Omit<CrewMember, 'deck' | 'isCurrent'>[] = []
let baseDecks: Record<string, Deck> = {}
let lastScan = 0
// Why the archive check could not run on the last scan, shown in the pane; undefined when it ran
let archiveProblem: string | undefined
// The app's sessions as the last archive check read them, for tagging each chat with its crew emoji
type AppSession = { sessionId?: string; title?: string; cwd?: string; isArchived?: boolean }
let appSessions: AppSession[] = []
// Chats whose retitle the app refused (the captain declined it): asked once per load, not every scan
const tagRefused = new Set<string>()
// Where each sprite stands now. A sprite moves only when its next deck is known; otherwise it stays
const placed: Record<string, Deck> = {}
// When the latest turn began, so a scan from before it is not trusted for this session's project
let latestTurnStart = 0
const walkFrom: Record<string, { x: number; y: number }> = {}
const walkTo: Record<string, { x: number; y: number }> = {}
// When each walk began: past WALK_MS the picture draws the sprite standing still
const walkAt: Record<string, number> = {}
const WALK_MS = 1800

// ~/.claude/projects names a project's path with every / and . turned into -; rebuild it.
// A dash may also be a real one (my-space), so try each split and back up on a dead end.
// Spaces, underscores and other marks became dashes too ("Side Work"): when the dashed name
// is not there, look in the folder for an entry that encodes to it
const encodeName = (name: string) => name.replace(/[^a-zA-Z0-9]/g, '-')
// Folders already decoded, by their ~/.claude/projects name: one check that the folder is still
// there replaces the walk on later scans
const decoded = new Map<string, string>()
async function decodeProjectDir($: EngineInterface, name: string): Promise<string | undefined> {
  const known = decoded.get(name)
  if (known && (await $.fs.exists(known))) return known
  decoded.delete(name)
  const found = await walkProjectDir($, name)
  if (found) decoded.set(name, found)
  return found
}
async function walkProjectDir($: EngineInterface, name: string): Promise<string | undefined> {
  const parts = name.replace(/^-/, '').split('-')
  const listings = new Map<string, Promise<string[]>>()
  const entries = (dir: string) => {
    if (!listings.has(dir)) listings.set(dir, $.fs.list(dir || '/').then(xs => xs.filter(x => x.kind === 'dir').map(x => x.name), () => []))
    return listings.get(dir)!
  }
  async function walk(path: string, i: number): Promise<string | undefined> {
    if (i >= parts.length) return path
    // Two dashes in a row were "/." : a dot folder such as .claude
    const isDot = parts[i] === ''
    const start = isDot ? i + 1 : i
    for (let j = start; j < parts.length; j++) {
      const dashed = `${isDot ? '.' : ''}${parts.slice(start, j + 1).join('-')}`
      let candidate = `${path}/${dashed}`
      if (!(await $.fs.exists(candidate))) {
        const real = (await entries(path)).find(n => encodeName(n) === encodeName(dashed))
        if (!real) continue
        candidate = `${path}/${real}`
      }
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

// ── Removing and adding crew: every folder with chats here is crew until removed. A removed
// folder (store key crewHidden) leaves the crew decks, the hub roster and the sidebar emoji and
// frees its sprite; every other part of the mod still runs in its chats. An added folder (store
// key crewAdded) is always aboard, even past the newest 10 (one per sprite) or with no chats yet ──

const CREW_TOOL = 'mcp__starfleet__starfleet_crew'
const editLock = serial()
// Folders with chats here that did not fit on the decks, offered by Add
let spare: string[] = []
// Manage crew: which page shows, which project's page is open, and what waits on an inline yes or
// no (`remove`: the open project; a path: the folder picked on Add). `isTyping` shows the field for a
// folder that isn't listed
type ManagePage = 'crew' | 'add' | 'cloud'
// `draft`: the characters as changed on the Crew page, kept until Save
let manage: { page: ManagePage; confirm?: string; isTyping?: boolean; draft?: Record<string, string> } = { page: 'crew' }

// A pruned folder (store key crewPruned) is off the crew and off the Not aboard list too, so old
// test folders stop piling up there. The folder itself is untouched; adding it again unprunes it
async function pathList($: EngineInterface, key: 'crewHidden' | 'crewAdded' | 'crewPruned'): Promise<string[]> {
  const saved = await $.store.get(key)
  return Array.isArray(saved) ? (saved as string[]) : []
}
export const hiddenProjects = ($: EngineInterface) => pathList($, 'crewHidden')

// The most crew there is room for: one sprite each, less the picked cloud repos
async function crewCap($: EngineInterface) {
  return CREW_MAX - (await cloudPicks($)).length
}

// Removing hides a folder and unpins it. Adding first undoes a removal; only a folder that still
// isn't aboard then (no chats here, or past the newest 10) is pinned, while there is room.
// Answers why it couldn't, or undefined when done
async function setAboard($: EngineInterface, path: string, isAboard: boolean): Promise<string | undefined> {
  const wasHidden = (await hiddenProjects($)).includes(path)
  const wasPruned = (await pathList($, 'crewPruned')).includes(path)
  if (!isAboard || wasHidden || wasPruned) {
    await editLock(async () => {
      const hidden = (await pathList($, 'crewHidden')).filter(p => p !== path)
      await $.store.set('crewHidden', isAboard ? hidden : [...hidden, path])
      if (!isAboard) await $.store.set('crewAdded', (await pathList($, 'crewAdded')).filter(p => p !== path))
      if (isAboard && wasPruned) await $.store.set('crewPruned', (await pathList($, 'crewPruned')).filter(p => p !== path))
    })
    await scanCrew($)
  }
  if (isAboard && !roster.some(c => c.path === path)) {
    const cap = await crewCap($)
    const isFull = await editLock(async () => {
      const added = await pathList($, 'crewAdded')
      if (added.includes(path)) return false
      if (added.length >= cap) return true
      await $.store.set('crewAdded', [...added, path])
      return false
    })
    if (isFull) return `The crew is full: ${cap} projects are added by hand. Remove one first.`
    await scanCrew($)
  }
  $.ui.invalidate('ui.render')
  return undefined
}

// Confirms are inline buttons, not the app's question box: on desktop that box can open where it
// isn't seen, and the chat then spins on a turn that waits for an answer no one can give

function setManage($: EngineInterface, next: Partial<typeof manage>) {
  manage = { page: manage.page, draft: manage.draft, ...next }
  $.ui.invalidate('ui.render')
}

// Open Manage crew, on one of its pages; the console's crew buttons and /crew both come here
export async function openManageCrew($: EngineInterface, page: ManagePage = 'crew') {
  setManage($, { page })
  void loadRecentRepos($).then(() => $.ui.invalidate('ui.render'))
  return $.ui.open({ id: CREW_PANE, title: '👥 Manage crew', focus: true, closeOnEscape: true })
}

async function removeFromCrew($: EngineInterface, path: string) {
  setManage($, { draft: undefined })
  await setAboard($, path, false)
  $.ui.toast(`${basename(path)} left the crew. The rest of the mod still runs in its chats.`)
}

async function addToCrew($: EngineInterface, path: string) {
  const problem = await setAboard($, path, true)
  // Land on the Crew page, where the newcomer's character can be changed
  setManage($, problem ? {} : { page: 'crew', draft: undefined })
  $.ui.toast(problem ?? `${basename(path)} joined the crew.`)
}

// Prune a folder off the Not aboard list at once: it is easy to undo (type its path under Add
// another folder), so it doesn't ask. A spare takes its place on the next scan
async function pruneFolder($: EngineInterface, path: string) {
  await editLock(async () => {
    const pruned = await pathList($, 'crewPruned')
    if (!pruned.includes(path)) await $.store.set('crewPruned', [...pruned, path])
    await $.store.set('crewHidden', (await pathList($, 'crewHidden')).filter(p => p !== path))
  })
  await scanCrew($)
  $.ui.invalidate('ui.render')
  $.ui.toast(`${basename(path)} pruned from the list. The folder itself is untouched.`)
}

// A folder with no chats here yet, typed as a full path (~ for home); typing it is the confirm
async function addOtherFolder($: EngineInterface, typed: string) {
  const home = (await $.env.get('HOME')) ?? ''
  const path = typed.trim().replace(/^~(?=\/|$)/, home).replace(/\/+$/, '')
  if (!path.startsWith('/') || !(await $.fs.exists(path))) {
    $.ui.toast(`No folder at ${typed.trim()}. Give its full path, like ~/Projects/app.`)
    return
  }
  await addToCrew($, path)
}

// Give a project the character picked for it. One who already serves another project swaps with
// it, so no two projects ever share a character or a chat tag. The pick sticks like any other
export async function pickCharacter($: EngineInterface, path: string, sprite: string) {
  await editLock(async () => {
    const assigned = ((await $.store.get('crewAssign')) ?? {}) as Record<string, string>
    const before = assigned[path]
    for (const [other, held] of Object.entries(assigned)) if (held === sprite && other !== path) {
      if (before) assigned[other] = before
      else delete assigned[other]
    }
    assigned[path] = sprite
    await $.store.set('crewAssign', assigned)
  })
  await scanCrew($)
  $.ui.invalidate('ui.render')
}

type El = ReturnType<EngineInterface['ui']['resolve']>

// A crew member's sprite at about a line of text tall, for the Crew page rows and the bench
function miniSvg(sprite: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 9" width="16" height="18" shape-rendering="crispEdges">${pixels(SPRITES[sprite]?.rows ?? [], CREW_PALETTE)}</svg>`
}

function mini(el: El, sprite: string): RenderElement {
  return 'Svg' in el ? <el.Svg source={miniSvg(sprite)} alt={SPRITES[sprite]?.name ?? sprite} width={16} height={18} /> : <el.Text>{' '}</el.Text>
}

// The characters as the Crew page shows them: the draft when one is open, else what's saved
function draftOf(crew: CrewMember[]): Record<string, string> {
  return manage.draft ?? Object.fromEntries(crew.map(c => [c.path, c.sprite]))
}

// The next character for one project, stepping through the cast in its order but only over the
// free ones (benched in the draft) and its own, so no two projects can ever hold the same one
function cycle($: EngineInterface, crew: CrewMember[], path: string, by: 1 | -1) {
  const draft = draftOf(crew)
  const taken = new Set(Object.entries(draft).filter(([p]) => p !== path).map(([, s]) => s))
  const options = SPRITE_ORDER.filter(k => !taken.has(k))
  const at = Math.max(0, options.indexOf(draft[path]!))
  setManage($, { draft: { ...draft, [path]: options[(at + by + options.length) % options.length]! } })
}

// Save writes every change in the draft at once; the draft never holds a character twice
async function saveDraft($: EngineInterface) {
  const draft = manage.draft
  if (!draft) return
  await editLock(async () => {
    const assigned = ((await $.store.get('crewAssign')) ?? {}) as Record<string, string>
    await $.store.set('crewAssign', { ...assigned, ...draft })
  })
  setManage($, { draft: undefined })
  await scanCrew($)
  $.ui.toast('👥 Crew assignments saved.')
}

// The Crew page: every project aboard with its character, changed with ◀ ▶ and kept only on Save,
// then the bench of characters no project has. Kept to a line a row so the tab fits without scrolling
// (a scrolling pane shivers once a button in it has focus)
function crewPage($: EngineInterface, el: El, crew: CrewMember[], cwd: string): RenderElement {
  const { Box, Text, Button } = el
  if (crew.length === 0) return <Text dimColor>No crew aboard yet. Open Add / remove to bring one onto the decks.</Text>
  const draft = draftOf(crew)
  const isChanged = crew.some(c => draft[c.path] !== c.sprite)
  const benched = SPRITE_ORDER.filter(k => !Object.values(draft).includes(k))
  return (
    <Box flexDirection="column" rowGap={1}>
      <Text bold>Claimed</Text>
      <Box flexDirection="column">
        {crew.map(c => {
          const sprite = draft[c.path]!
          return (
            <Box key={`row-${c.path}`} flexDirection="row" columnGap={1} alignItems="center">
              <Button key={`prev-${c.path}`} label="◀" plain dimColor onPress={() => cycle($, crew, c.path, -1)} />
              {mini(el, sprite)}
              <Button key={`next-${c.path}`} label="▶" plain dimColor onPress={() => cycle($, crew, c.path, 1)} />
              <Text wrap="truncate">
                {SPRITES[sprite]?.emoji ?? ''} <Text bold color={sprite !== c.sprite ? LCARS.gold : undefined}>{SPRITES[sprite]?.name ?? sprite}</Text>
                <Text dimColor> · {c.project}{c.path === cwd ? ' (this chat)' : ''}</Text>
              </Text>
            </Box>
          )
        })}
      </Box>
      <Box flexDirection="row" columnGap={2} alignItems="center">
        {isChanged
          ? <Button key="crew-save" label="Save" variant="primary" onPress={() => saveDraft($)} />
          : <Text dimColor>◀ ▶ changes a project's character. Nothing changes until you press Save.</Text>}
        {isChanged && <Button key="crew-cancel" label="Cancel" plain onPress={() => setManage($, { draft: undefined })} />}
        {isChanged && <Text color={LCARS.gold}>Unsaved changes</Text>}
      </Box>
      <Text bold>Benched</Text>
      {benched.length === 0 && <Text dimColor>Every character has a project.</Text>}
      {/* Two columns side by side, each read top to bottom: the first half of the bench (the squares)
          down the left, the rest down the right */}
      <Box flexDirection="row" columnGap={2}>
        {[benched.slice(0, Math.ceil(benched.length / 2)), benched.slice(Math.ceil(benched.length / 2))].map((column, i) => (
          <Box key={`bench-col-${i}`} flexDirection="column" width="50%" flexShrink={1} minWidth={0}>
            {column.map(k => (
              <Box key={`bench-${k}`} flexDirection="row" columnGap={1} alignItems="center">
                {mini(el, k)}
                <Text wrap="truncate">{SPRITES[k]!.emoji} {SPRITES[k]!.name}</Text>
              </Box>
            ))}
          </Box>
        ))}
      </Box>
    </Box>
  )
}

// The Add / remove page, in two columns: the crew on the left, each with → to move it off (asking
// first, Keep the default), and the folders not aboard on the right, each with ← to bring it on at
// once, plus a field for any other folder
async function addPage($: EngineInterface, el: El, crew: CrewMember[], cwd: string): Promise<RenderElement> {
  const { Box, Text, Button } = el
  const aboard = new Set(crew.map(c => c.path))
  const pruned = new Set(await pathList($, 'crewPruned'))
  const offer = [...new Set([...(aboard.has(cwd) ? [] : [cwd]), ...(await hiddenProjects($)), ...spare])].filter(p => !aboard.has(p) && !pruned.has(p))
  const isFull = crew.length >= CREW_MAX
  const picked = manage.confirm
  if (picked?.startsWith('remove:')) {
    const path = picked.slice('remove:'.length)
    const name = basename(path)
    const isCloud = path.startsWith(CLOUD_PREFIX)
    return (
      <Box flexDirection="row" columnGap={2} flexWrap="wrap" alignItems="center">
        <Text bold>Remove {name} from the crew?</Text>
        <Button key="crew-no" label="Keep" plain onPress={() => setManage($, {})} />
        <Button key="crew-yes" label={`Remove ${name}`} plain onPress={() => (isCloud ? toggleCloudPick($, path.slice(CLOUD_PREFIX.length)).then(() => scanCrew($)).then(() => setManage($, {})) : removeFromCrew($, path))} />
      </Box>
    )
  }
  return (
    <Box flexDirection="row" columnGap={2}>
      <Box width="50%" flexDirection="column" flexShrink={1} minWidth={0}>
        <Text bold>On the crew</Text>
        {crew.length === 0 && <Text dimColor>No crew aboard yet.</Text>}
        {crew.map(c => (
          <Box key={`aboard-${c.path}`} flexDirection="row" columnGap={1} alignItems="center">
            <Text wrap="truncate">{SPRITES[c.sprite]?.emoji ?? ''} {c.project}</Text>
            <Button key={`crew-drop-${c.path}`} label="→" plain dimColor onPress={() => setManage($, { confirm: `remove:${c.path}` })} />
          </Box>
        ))}
      </Box>
      <Box width="50%" flexDirection="column" flexShrink={1} minWidth={0}>
        <Text bold>Not aboard</Text>
        {isFull && <Text dimColor>The crew is full: {CREW_MAX} aboard. Move one over to make room.</Text>}
        {offer.length === 0 && <Text dimColor>No other projects with chats here.</Text>}
        {offer.length > 0 && <Text dimColor>✕ prunes a folder off this list. The folder itself stays.</Text>}
        {/* The list shows even when the crew is full, so it can still be pruned; ← only when there is room */}
        {offer.map(p => (
          <Box key={`ashore-${p}`} flexDirection="row" columnGap={1} alignItems="center">
            {!isFull && <Button key={`crew-pick-${p}`} label="←" plain dimColor onPress={() => addToCrew($, p)} />}
            <Text wrap="truncate">{basename(p)}{p === cwd ? ' (this chat)' : ''}</Text>
            <Button key={`crew-prune-${p}`} label="✕" plain dimColor onPress={() => pruneFolder($, p)} />
          </Box>
        ))}
        {!isFull && !manage.isTyping && <Button key="crew-other" label="Add another folder…" plain onPress={() => setManage($, { isTyping: true })} />}
        {!isFull && manage.isTyping && 'Input' in el && (
          <Box flexDirection="column">
            <Text dimColor>Type its full path, like ~/Projects/app, then ↵.</Text>
            <el.Input key="crew-other-path" value="" submitLabel="↵" onSubmit={value => addOtherFolder($, value)} />
          </Box>
        )}
      </Box>
    </Box>
  )
}

// The Cloud repos page: repos cloud sessions work in, picked to come aboard
async function cloudPage($: EngineInterface, el: El, now: number): Promise<RenderElement> {
  const { Box, Text, Button } = el
  const picks = await cloudPicks($)
  return (
    <Box flexDirection="column" rowGap={1}>
      <Text color={LCARS.gold}>Cloud environments may reduce mod functionality.</Text>
      {repoProblem && <Text dimColor>GitHub not reachable: {repoProblem}</Text>}
      {!repoProblem && recentRepos.length === 0 && <Text dimColor>Reading your GitHub repos…</Text>}
      {/* Two columns side by side, each read top to bottom (newest pushed first), like the bench */}
      <Box flexDirection="row" columnGap={2}>
        {[recentRepos.slice(0, Math.ceil(recentRepos.length / 2)), recentRepos.slice(Math.ceil(recentRepos.length / 2))].map((column, i) => (
          <Box key={`cloud-col-${i}`} flexDirection="column" width="50%" flexShrink={1} minWidth={0} alignItems="flex-start">
            {column.map(r => {
              const isPicked = picks.includes(r.repo)
              return <Button key={`cloud-${r.repo}`} label={`${isPicked ? '☑' : '☐'} ${r.repo.split('/').pop()} · ${ago(now - r.pushedAt)}`} {...(isPicked ? {} : { plain: true as const })} onPress={async () => {
                await toggleCloudPick($, r.repo)
                await scanCrew($)
                $.ui.invalidate('ui.render')
              }} />
            })}
          </Box>
        ))}
      </Box>
    </Box>
  )
}

// The starfleet_crew tool: a project by its folder name (any case) or full path, off the crew or
// back aboard. Answers what happened, for Claude to relay
async function setProjectByName($: EngineInterface, project: string, isAboard: boolean): Promise<string> {
  const home = (await $.env.get('HOME')) ?? ''
  const typed = project.trim().replace(/^~(?=\/|$)/, home).replace(/\/+$/, '')
  const known = [...new Set([...roster.map(c => c.path), ...(await hiddenProjects($)), ...(await pathList($, 'crewAdded')), ...(await pathList($, 'crewPruned')), ...spare, projectOf(await $.session.cwd())!])]
  const path = typed.startsWith('/') ? typed : known.find(p => basename(p).toLowerCase() === typed.toLowerCase())
  if (!path || (typed.startsWith('/') && !(await $.fs.exists(path)))) return `No project folder named ${project}. Give its folder name as the crew decks show it, or its full path.`
  const name = basename(path)
  if (!isAboard) {
    await setAboard($, path, false)
    return `${name} left the crew: off the crew decks, the hub roster and the sidebar emoji. The rest of the mod still runs there.`
  }
  return (await setAboard($, path, true)) ?? `${name} is aboard.`
}

// How many sessions one archive check reads from the app
const SESSION_LIMIT = 1000

// Put each live chat's crew emoji in front of its name in the sidebar, the same emoji the crew
// decks show for that project, and take it off chats whose project has no sprite (removed, or
// its sprite went to a newcomer). This chat comes from get_session (list_sessions leaves it out)
async function tagChats($: EngineInterface, assigned: Record<string, string>) {
  const sessions = appSessions.filter(s => !s.isArchived)
  try {
    const self = await $.mcp.call('ccd_session_mgmt', 'get_session', { session_id: 'self' })
    const text = self.content.find(c => c.type === 'text')?.text
    if (!self.isError && text) sessions.push({ ...(JSON.parse(text) as AppSession), sessionId: 'self' })
  } catch {
    // not in the desktop app: no sidebar to tag
  }
  for (const s of sessions) {
    const project = projectOf(s.cwd) ?? ''
    const emoji = SPRITES[assigned[project] ?? '']?.emoji
    const title = emoji ? taggedTitle(s.title ?? '', emoji) : untaggedTitle(s.title ?? '')
    if (!s.sessionId || tagRefused.has(s.sessionId) || title === s.title) continue
    try {
      const result = await $.mcp.call('ccd_session_mgmt', 'set_session_title', { session_id: s.sessionId, title })
      if (result.isError) tagRefused.add(s.sessionId)
    } catch {
      tagRefused.add(s.sessionId)
    }
  }
}

// Project folders whose app sessions are all archived. Asks the desktop app's session list;
// outside the app (no such server) nothing counts as archived
async function archivedProjects($: EngineInterface): Promise<Set<string>> {
  const archived = new Set<string>()
  archiveProblem = undefined
  appSessions = []
  try {
    const result = await $.mcp.call('ccd_session_mgmt', 'list_sessions', { include_archived: true, limit: SESSION_LIMIT })
    // Content blocks are not a tagged union, so read .text itself rather than narrow on type
    const text = result.content.find(c => c.type === 'text')?.text
    if (result.isError || text === undefined) {
      archiveProblem = text?.slice(0, 160) ?? 'session list returned no text'
      return archived
    }
    const sessions = JSON.parse(text) as AppSession[]
    appSessions = sessions
    // A full page may leave out older live sessions: hide nothing rather than guess
    if (sessions.length >= SESSION_LIMIT) {
      archiveProblem = `over ${SESSION_LIMIT} sessions to check`
      return archived
    }
    const live = new Set<string>()
    for (const s of sessions) {
      const cwd = projectOf(s.cwd)
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
  const cwd = projectOf(await $.session.cwd())!
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
  // A retired sprite passes to the character who replaced it (Quark's projects become the Gorn's)
  for (const [path, sprite] of Object.entries(assigned)) if (RETIRED_SPRITES[sprite]) assigned[path] = RETIRED_SPRITES[sprite]!
  const archived = await archivedProjects($)
  // Pruned folders are skipped like removed ones, so they leave the spares too
  const hidden = new Set([...(await hiddenProjects($)), ...(await pathList($, 'crewPruned'))])
  const now = await $.clock.now()
  const found: typeof roster = []
  const decks: Record<string, Deck> = {}
  const seen = new Set<string>()
  const picks = await cloudPicks($)
  const aboardLocal: { path: string; mtimeMs: number }[] = []
  const spareFound: string[] = []
  const cap = await crewCap($)
  // Added folders that still exist always fit, a full crew of them at most; the newest of the
  // rest fill what is left, and up to 6 more wait as spares for Add
  const pinned = await Promise.all((await pathList($, 'crewAdded')).filter(p => !hidden.has(p)).map(async p => ((await $.fs.exists(p)) ? p : '')))
  const added = pinned.filter(Boolean).slice(0, cap)
  const others = cap - added.length
  let regular = 0
  for (const entry of entries) {
    if (regular >= others && spareFound.length >= 6) break
    // Scratch, temp and .claude chats never join: skip them before the costly decode
    if (/^-(private|tmp)-|--claude-/.test(entry.name)) continue
    const path = await decodeProjectDir($, entry.name)
    // The home folder counts too: a chat opened without a project folder is a project of its own
    if (!path || seen.has(path) || hidden.has(path) || /\/\.claude\/|\/tmp\/|\/private\/|\/Library\//.test(path)) continue
    const isAdded = added.includes(path)
    // Archived in the app: off the decks (this session's project and added ones always stay)
    if (archived.has(path) && path !== cwd && !isAdded) continue
    seen.add(path)
    if (isAdded) aboardLocal.push({ path, mtimeMs: entry.mtimeMs })
    else if (regular < others) {
      aboardLocal.push({ path, mtimeMs: entry.mtimeMs })
      regular += 1
    } else spareFound.push(path)
  }
  // An added folder with no chats here yet: its own modified time stands in
  for (const path of added) {
    if (seen.has(path)) continue
    seen.add(path)
    aboardLocal.push({ path, mtimeMs: await $.fs.stat(path).then(st => st.mtimeMs, () => 0) })
  }
  aboardLocal.sort((a, b) => b.mtimeMs - a.mtimeMs)
  spare = spareFound
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
  // A project keeps its sprite for good, aboard or not, so the captain learns who is who; no
  // sprite is ever switched. A newcomer takes a free sprite, avoiding its neighbor's shirt color
  // when it can. With all eight taken, it takes one from a project no longer aboard (archived,
  // moved, or past the newest 10), the one that got its sprite earliest
  const aboard = new Set(found.map(c => c.path))
  for (const path of hidden) delete assigned[path]
  for (const [i, c] of found.entries()) {
    if (!assigned[c.path]) {
      const prev = i > 0 ? shirtOf(assigned[found[i - 1]!.path]) : undefined
      const held = new Set(Object.values(assigned))
      const free = SPRITE_ORDER.filter(k => !held.has(k))
      let pick = free.find(k => shirtOf(k) !== prev) ?? free[0]
      if (!pick) {
        const departed = Object.keys(assigned).filter(p => !aboard.has(p))
        const gone = departed.find(p => shirtOf(assigned[p]) !== prev) ?? departed[0]
        if (gone) {
          pick = assigned[gone]
          delete assigned[gone]
        }
      }
      assigned[c.path] = pick ?? SPRITE_ORDER[i % SPRITE_ORDER.length]!
    }
    c.sprite = assigned[c.path]!
    c.name = SPRITES[c.sprite]?.name ?? 'Crew'
  }
  roster = found
  baseDecks = decks
  lastScan = now
  await $.store.set('crewAssign', assigned)
  await $.store.set('crew', found.map((c, order) => ({ ...c, deck: decks[c.path], order })))
  await tagChats($, assigned)
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
    const path = projectOf(await $.session.cwd())!
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
  const cwd = projectOf(await $.session.cwd())!
  const a = await read($, activity)
  const isInTurn = a.turnStartedAt !== null
  if (isInTurn) latestTurnStart = Math.max(latestTurnStart, a.turnStartedAt!)
  // A worktree chat counts for its project, as its chat tag does
  return roster.map(c => {
    const isCurrent = c.path === cwd
    // While this chat's turn runs, every sprite holds still, so the picture never changes under a
    // working pane (a changed picture makes the pane lose its scroll place). After the turn this
    // session's sprite waits for a scan taken since the turn began before it walks anywhere
    const next: Deck | undefined = isInTurn ? undefined
      : !isCurrent ? live[c.path] ?? baseDecks[c.path]
      : lastScan >= latestTurnStart ? baseDecks[c.path] : undefined
    const deck = next ?? placed[c.path] ?? baseDecks[c.path] ?? 'quarters'
    placed[c.path] = deck
    return { ...c, deck, isCurrent }
  })
}

// The picture's shape depends on the crew size alone: every deck is full height, and the width fits
// the whole crew on one deck. A picture that changes shape as sprites move makes the pane lose its
// scroll place
export function crewSvg(crew: CrewMember[], now: number): string {
  const tops = DECKS.map((_, i) => 4 + i * DECK_H)
  const height = 4 + DECKS.length * DECK_H + 4
  // Wide enough for the whole crew on one deck and its name. It claims more width than any pane,
  // so the surface always scales it to the box (height follows)
  const width = Math.max(420, 14 + crew.length * SLOT_W + 140)
  const slots: Record<string, number> = {}
  let sprites = ''
  let style = ''
  crew.forEach((c, i) => {
    const row = DECKS.findIndex(d => d.id === c.deck)
    const slot = (slots[c.deck] = (slots[c.deck] ?? 0) + 1) - 1
    const to = { x: 14 + slot * SLOT_W, y: tops[row]! + 4 }
    const prev = walkTo[c.sprite]
    if (!prev || prev.x !== to.x || prev.y !== to.y) {
      walkFrom[c.sprite] = prev ?? to
      walkTo[c.sprite] = to
      walkAt[c.sprite] = now
    }
    const from = walkFrom[c.sprite]!
    const art = pixels(SPRITES[c.sprite]?.rows ?? SPRITES.data!.rows, CREW_PALETTE, 4)
    // Every redraw loads the picture afresh and restarts its animations, so the walk is drawn only
    // while it is under way; after that the sprite stands where it arrived. Left in, it would replay
    // from the old deck on each redraw and the sprite would jitter there, never arriving
    const isWalking = now - (walkAt[c.sprite] ?? 0) < WALK_MS && (from.x !== to.x || from.y !== to.y)
    style += isWalking
      ? `@keyframes w${i}{0%{transform:translate(${from.x}px,${from.y}px)}100%{transform:translate(${to.x}px,${to.y}px)}}.s${i}{transform:translate(${to.x}px,${to.y}px);animation:w${i} ${WALK_MS / 1000}s steps(9) forwards}`
      : `.s${i}{transform:translate(${to.x}px,${to.y}px)}`
    sprites += `<g class="s${i}"><g class="${c.isCurrent ? 'hop' : 'idle'}" style="animation-delay:${(i % 4) * 0.2}s">${art}</g>`
      + `<text x="16" y="49" text-anchor="middle" font-family="Space Mono,monospace" font-size="10" fill="#f1ece4">${c.project.slice(0, 9).replace(/[<&>]/g, '')}</text>`
      + (c.isCurrent ? '<rect x="4" y="-5" width="24" height="2" fill="#ffcc33" class="hop"/>' : '')
      + '</g>'
  })
  const decks = DECKS.map((d, i) => {
    const h = (tops[i + 1] ?? height - 4) - tops[i]! - 4
    return `<rect x="0" y="${tops[i]}" width="${width}" height="${h}" rx="4" fill="#12121c"/>`
      + `<rect x="0" y="${tops[i]}" width="6" height="${h}" fill="${d.color}"/>`
      + `<text x="${width - 8}" y="${tops[i]! + 12}" text-anchor="end" font-family="Antonio,Arial Narrow,sans-serif" font-size="10" letter-spacing="1" fill="${d.color}">${d.label}</text>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${FILL_WIDTH}" height="${Math.round((FILL_WIDTH * height) / width)}" shape-rendering="crispEdges">
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
  await $.tool.register({
    name: 'starfleet_crew',
    description: 'Remove a project folder from the Starfleet crew, or add one. A removed folder leaves the crew decks, the hub roster and the sidebar emoji; the rest of the mod keeps running in its chats. An added one stays aboard. Use when the captain says a folder is not a project, or asks to add, remove, stop or start tracking one.',
    inputSchema: { type: 'object', properties: { project: { type: 'string', description: 'The project folder name as the crew decks show it, or its full path' }, aboard: { type: 'boolean', description: 'false to remove it from the crew, true to add it' } }, required: ['project', 'aboard'] },
  })
  // Scan once at start, so this chat gets its crew emoji without waiting for a turn to end
  void scanCrew($).catch(() => {})
  await $.command.register({ name: 'crew', description: 'Open the crew decks: your projects as 8-bit crew members, and pick cloud repos to bring aboard', immediate: true }).catch(() => {})
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

  on('tool.call', { tool: CREW_TOOL }, async ($: EngineInterface, e: { project?: unknown; aboard?: unknown }) => {
    if (typeof e.project !== 'string' || !e.project || typeof e.aboard !== 'boolean') return { result: 'Give project (its folder name) and aboard (true or false).' }
    return { result: await setProjectByName($, e.project, e.aboard) }
  })

  on('command.run', { command: 'crew' }, async $ => {
    await scanCrew($)
    const opened = await openManageCrew($)
    return opened.isPlaced ? {} : { text: `Manage crew not shown: ${opened.reason}` }
  })

  // Manage crew: three short pages across the top instead of one long list, so the tab fits
  // without scrolling
  on('ui.render', { component: 'Pane', requestId: CREW_PANE }, async ($, e) => {
    const el = $.ui.resolve(e)
    const { Box, Text, Button } = el
    const crew = await crewNow($)
    const cwd = projectOf(await $.session.cwd())!
    const now = await $.clock.now()
    const tab = (page: ManagePage, label: string) => (
      <Button key={`manage-${page}`} label={label} {...(manage.page === page ? { variant: 'primary' as const } : { plain: true as const })} onPress={() => setManage($, { page })} />
    )
    const body = manage.page === 'add' ? await addPage($, el, crew, cwd)
      : manage.page === 'cloud' ? await cloudPage($, el, now)
      : crewPage($, el, crew, cwd)
    return (
      <Box flexDirection="column" rowGap={1} padding="sm">
        <Text backgroundColor={HEAD_COLOR} color={LCARS.ink} bold> MANAGE CREW · {crew.length} OF {CREW_MAX} ABOARD </Text>
        <Box flexDirection="row" columnGap={1} flexWrap="wrap">
          {tab('crew', 'Crew')}
          {tab('add', 'Add / remove')}
          {tab('cloud', 'Cloud repos')}
        </Box>
        {body}
        <Text dimColor italic>Up to {CREW_MAX} crew aboard, one character each, so everyone fits on the viewscreen and decks.</Text>
        {archiveProblem && <Text dimColor>Archived projects not hidden: {archiveProblem}</Text>}
        <Box flexDirection="column">
          <Button key="rescan" label="Rescan crew" hotkey="n" plain onPress={() => rescan($)} />
          <Text dimColor>Re-reads your project folders, their git changes and archived chats now. The crew rescans at the end of every turn, so use this when the decks look out of date between turns: after archiving a chat, committing outside Claude, or making a new project folder.</Text>
        </Box>
      </Box>
    )
  })
}
