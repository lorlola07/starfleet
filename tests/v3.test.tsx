import { expect, test } from 'claude-code/testing'
import { TEST_OR_BUILD, stardate } from '../hooks/shared'
import { courseOf } from '../hooks/voyage'
import { CREW_MAX, SPRITES, SPRITE_COLORS, SPRITE_ORDER, BADGE_W, LOG_CATEGORIES, rankBadgeSvg, splitCategory, rankOf, taggedTitle } from '../hooks/shared'
import { onDark, viewscreenSvg } from '../hooks/theme'
import { crewSvg } from '../hooks/crew'
import { isNewer } from '../hooks/update'
import { projectFor, reportId } from '../hooks/projects'

// The test runtime has timers; the mod's own types leave them out
// $.tool.call through a plain signature: inferring each tool's input type is too deep for tsc
const callTool = ($: { tool: { call: unknown } }, input: object) => ($.tool.call as (input: object) => Promise<unknown>)(input)

declare const setTimeout: (done: (...args: unknown[]) => void, ms: number) => unknown

const pane = (requestId: string, surface: 'terminal' | 'desktop') =>
  ({
    plugin: 'starfleet', component: 'Pane', requestId, surface,
    props: { title: requestId, isFocused: false, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  }) as const

const band = (surface: 'terminal' | 'desktop', isWorking: boolean) =>
  ({
    plugin: 'starfleet', component: 'AbovePrompt', requestId: 'band', surface,
    props: { hasSurvey: false, isWorking, maxRows: 6, bodyColumns: 80, scroll: { offset: 0, bodyRows: 6 }, view: {} },
  }) as const

// A project's deck, as the console's crew decks picture names it in its alt text ("Riker (MOD) on
// engineering")
async function deckOn($: { ui: { mount: (e: never) => Promise<any> } }, project: string): Promise<string | undefined> {
  const view = await $.ui.mount(pane('starfleet-console', 'desktop') as never)
  if (!(await view.find({ type: 'Button', key: 'manage-crew' }))) await view.press({ key: 'sec-crew' })
  const alt = (await view.findAll({ type: 'Svg' })).map((s: { props: { alt?: string } }) => String(s.props.alt ?? '')).find((a: string) => a.includes(`(${project}) on `)) ?? ''
  await view.unmount()
  const deck = alt.split(`(${project}) on `)[1] ?? ''
  return ['bridge', 'science', 'engineering', 'sickbay', 'quarters'].find(d => deck.startsWith(d))
}

// Pane ids opened through ui.open, newest last
const opened: string[] = []
// What session.id answers; a test may change it to act out /clear
let sessionId = 'sess-1'

// A test that needs the clock to stand still sets this, and clears it when done
let pinnedNow: number | undefined

function engine(on: any, run?: (_: unknown, e: { argv: string[] }) => unknown, live?: { name: string; text: string }, fs?: { exists?: (_: unknown, e: { path: string }) => unknown; list?: (_: unknown, e: { path: string }) => unknown; cwd?: string; toasts?: string[]; register?: (_: unknown, e: { name: string }) => unknown }) {
  const store: Record<string, unknown> = {}
  on('command.register', fs?.register ?? (() => ({ value: { command: 'x' } })))
  on('tool.register', () => ({ value: { tool: 'mcp__starfleet__x' } }))
  on('agent.register', () => ({ value: { agent: 'starfleet:away-team' } }))
  on('ui.open', (_: unknown, e: { id: string }) => (opened.push(e.id), { value: { isPlaced: true } }))
  on('store.get', (_: unknown, e: { key: string }) => ({ value: store[e.key] }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => { store[e.key] = e.value; return { value: undefined } })
  on('store.delete', (_: unknown, e: { key: string }) => { delete store[e.key]; return { value: undefined } })
  on('store.keys', () => ({ value: Object.keys(store) }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 150000, window: 200000, percent: 75 }, rateLimits: [] } }))
  on('session.cwd', () => ({ value: fs?.cwd ?? '/Users/cap/MOD' }))
  on('session.id', () => ({ value: sessionId }))
  on('env.get', () => ({ value: '/Users/cap' }))
  if (live) on('fs.read', (_: unknown, e: { path: string }) => (e.path.endsWith(live.name) ? { value: live.text } : { value: '' }))
  on('fs.list', fs?.list ?? ((_: unknown, e: { path: string }) => e.path.endsWith('starfleet-live') ? { value: live ? [{ name: live.name, kind: 'file', size: 1, mtimeMs: Date.now(), isLink: false }] : [] } : ({ value: [{ name: '-Users-cap-MOD', kind: 'dir', size: 0, mtimeMs: Date.now(), isLink: false }, { name: '-Users-cap-old-app', kind: 'dir', size: 0, mtimeMs: Date.now() - 9 * 86400000, isLink: false }] })))
  on('fs.exists', fs?.exists ?? (() => ({ value: true })))
  on('fs.stat', (_: unknown, e: { path: string }) => ({ value: { kind: 'dir', size: 0, mtimeMs: e.path.endsWith('old-app') ? Date.now() - 9 * 86400000 : Date.now(), isLink: false } }))
  on('process.run', run ?? (() => ({ value: { exitCode: 0, stdout: ' M hooks/core.tsx\n', stderr: '' } })))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.run', () => ({}))
  // What the engine and other plugins draw beneath starfleet
  on('ui.render', ($: { ui: { resolve: (e: unknown) => { Text: unknown } } }, e: unknown) => {
    const { Text } = $.ui.resolve(e) as { Text: any }
    return <Text>other plugin band</Text>
  })
  on('ui.toast', (_: unknown, e: { text?: string }) => { fs?.toasts?.push(String(e.text ?? '')); return { value: undefined } })
  on('ui.status', () => ({ value: undefined }))
  on('clock.now', () => ({ value: pinnedNow ?? Date.now() }))
  on('audio.speak', () => ({ value: { synthesizer: 'test' } }))
  return store
}

test('warp core, log, crew and band draw on desktop and terminal', async ($, on) => {
  const store = engine(on)
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  // The console opens unasked at session start
  expect(opened).toContain('starfleet-console')
  const run = $.command.run as (input: { command: string; args: string }) => Promise<unknown>
  await run({ command: 'log', args: 'tribbles as a test fixture' })
  // The log is kept per session, under the session id
  expect(JSON.stringify(store['log:sess-1'])).toContain('tribbles')
  expect(store.log).toBeUndefined()
  await run({ command: 'crew', args: '' })

  for (const surface of ['desktop', 'terminal'] as const) {
    const core = await $.ui.mount(pane('starfleet-core', surface))
    expect((await core.find({ type: 'Text', text: /WARP CORE/ }))?.text).toContain('ENGINEERING')
    expect(await core.find({ type: 'Button', key: 'compact' })).toBeTruthy()
    await core.unmount()

    const log = await $.ui.mount(pane('starfleet-log', surface))
    expect((await log.find({ type: 'Text', text: /tribbles/ }))?.text).toContain('tribbles')
    await log.unmount()

    const crew = await $.ui.mount(pane('starfleet-crew', surface))
    expect((await crew.find({ type: 'Text', text: /ABOARD/ }))?.text).toContain('MANAGE CREW · 2 OF 11 ABOARD')
    await crew.unmount()

    const idle = await $.ui.mount(band(surface, false))
    expect((await idle.find({ type: 'Text', text: /ASSIMILATION/ }))?.text).toContain('75%')
    // Starfleet's band never hides what other plugins and the engine draw there
    expect(await idle.find({ type: 'Text', text: /other plugin band/ })).toBeTruthy()
    await idle.unmount()

    const busy = await $.ui.mount(band(surface, true))
    expect(await busy.find({ type: 'Text', text: /other plugin band/ })).toBeTruthy()
    await busy.unmount()
  }
})

test('the console draws its LCARS layout on desktop and terminal', async ($, on) => {
  const store = engine(on)
  on('fs.read', () => ({ value: '# Handoff\nNext: wire the hub sync' }))
  on('model.complete', () => ({ value: { isAnswered: true, text: 'LEFT OFF: console built\nSTANDING ORDER: reload plugins\nWATCH FOR: Nothing flagged', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }))
  on('audio.play', () => ({ value: undefined }))
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  const run = $.command.run as (input: { command: string; args: string }) => Promise<unknown>
  await run({ command: 'log', args: 'beam up the tests' })
  await run({ command: 'starfleet', args: '' })

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount(pane('starfleet-console', surface))
    expect((await ui.find({ type: 'Text', text: /CONDITION (GREEN|YELLOW|BORG|RED)/ }))?.text).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /STARDATE \d{4}\.\d{2}\b/ }))?.text).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /TIME LOG/ }))?.text).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /MISSION BRIEFING/ }))?.text).toContain('BRIEFING')
    expect((await ui.find({ type: 'Text', text: /STANDING ORDER/ }))?.text).toContain('STANDING ORDER')
    // The captain's log is the newest entry and a button to the log tab, with no field here
    expect(await ui.find({ type: 'Button', key: 'open-log' })).toBeTruthy()
    expect(await ui.find({ type: 'Input' })).toBeFalsy()
    expect(await ui.find({ type: 'Button', key: 'sync' })).toBeFalsy()
    expect(await ui.find({ type: 'Button', key: 'ask' })).toBeFalsy()
    expect(await ui.find({ type: 'Button', key: 'md' })).toBeFalsy()
    // No entries on the console: they are listed only in the log tab
    expect(await ui.find({ type: 'Text', text: /beam up the tests/ })).toBeFalsy()
    expect(await ui.find({ type: 'Button', key: 'sec-bridge' })).toBeFalsy()
    const openSection = async (id: string) => {
      const header = await ui.find({ type: 'Button', key: 'sec-' + id })
      if (header?.text.startsWith('▸')) await ui.press({ key: 'sec-' + id })
    }
    for (const id of ['crew', 'core', 'record']) await openSection(id)
    expect(await ui.find({ type: 'Button', key: 'manage-crew' })).toBeTruthy()
    // Main engineering puts each label above its value
    expect(await ui.find({ type: 'Text', text: /^CORE LOAD$/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /^75%/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /^150k of 200k tokens$/ })).toBeTruthy()
    await ui.press({ key: 'sec-core' })
    expect(await ui.find({ type: 'Button', key: 'eject' })).toBeFalsy()
    await ui.press({ key: 'sec-core' })
    await ui.unmount()
  }
  expect(JSON.stringify(store.consoleOpen)).toContain('true')
})

test('the log saves notes as typed, and the course follows files changed and builds', async ($, on) => {
  const store = engine(on)
  on('audio.play', () => ({ value: undefined }))
  on('tool.call', () => ({ result: 'ok' }))
  on('prompt.submit', (_: unknown, e: { text: string }) => ({ text: e.text }))
  on('model.complete', () => ({ value: { isAnswered: true, text: 'Fix the warp core crash on startup.', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }))
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(pane('starfleet-console', 'desktop'))
  expect(await ui.find({ type: 'Text', text: /LAST ORDER/ })).toBeFalsy()
  await $.prompt.submit({ text: 'scan the nebula for tribbles' } as never)
  expect(await ui.find({ type: 'Text', text: /LAST ORDER/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /scan the nebula for tribbles/ })).toBeTruthy()
  // A long prompt with code shows a model's one-line summary, never the code
  await $.prompt.submit({ text: 'this crashes, fix it:\n```ts\nconst core = warp.start()\ncore.engage()\n```' } as never)
  await new Promise(done => setTimeout(done, 20))
  expect(await ui.find({ type: 'Text', text: /Fix the warp core crash on startup/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /core\.engage/ })).toBeFalsy()
  // The course stage and its detail sit on separate lines
  expect(await ui.find({ type: 'Text', text: /HOLDING ORBIT/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /no course plotted/ })).toBeTruthy()
  // Entries carry no type: no type menu or buttons, and the note is saved as typed
  expect(await ui.find({ type: 'Select', key: 'log-file' })).toBeFalsy()
  expect((await ui.findAll({ type: 'Button' })).some(b => String((b as { key?: string }).key ?? b.props.key).startsWith('log-type-'))).toBe(false)
  // Notes are typed in the log tab; the console then shows the newest
  const logTab = await $.ui.mount(pane('starfleet-log', 'desktop'))
  await $.ui.input({ plugin: 'starfleet', key: 'log-0', text: 'tribbles as fixtures' })
  expect(JSON.stringify(store['log:' + sessionId])).toContain('"text":"tribbles as fixtures"')
  await $.ui.input({ plugin: 'starfleet', key: 'log-1', text: 'plain note' })
  expect(JSON.stringify(store['log:' + sessionId])).toContain('"text":"plain note"')
  await logTab.unmount()
  expect(await ui.find({ type: 'Text', text: /plain note/ })).toBeFalsy()
  // Unnumbered blocks first: the Captain's log sits above the numbered crew section, no emoji
  const order = JSON.stringify(await $.ui.render(pane('starfleet-console', 'desktop')))
  expect(order.indexOf('CREW DECKS')).toBeGreaterThan(-1)
  expect(order.indexOf('CAPTAIN’S LOG')).toBeLessThan(order.indexOf('CREW DECKS'))
  // Under the stardate: the log, then the last order, then the briefing
  expect(order.indexOf('STARDATE')).toBeLessThan(order.indexOf('CAPTAIN’S LOG'))
  expect(order.indexOf('CAPTAIN’S LOG')).toBeLessThan(order.indexOf('LAST ORDER'))
  expect(order.indexOf('LAST ORDER')).toBeLessThan(order.indexOf('MISSION BRIEFING'))
  expect(order).not.toContain('📓 CAPTAIN')
  expect(order).not.toContain('💬 LAST ORDER')
  await callTool($, { tool: 'Edit', file_path: '/Users/cap/MOD/a.ts', old_string: 'a', new_string: 'b' })
  await callTool($, { tool: 'Bash', command: 'npm test' })
  expect(await ui.find({ type: 'Text', text: /MISSION ADVANCING/ })).toBeTruthy()
  const detail = await ui.find({ type: 'Text', text: /1 file changed/ })
  expect(detail?.text).toContain('tests passed once')
  expect(detail?.text).toContain('last check passed just now')
  expect(detail?.text).not.toContain('green build')
  expect(detail?.text).not.toContain('MISSION ADVANCING')
  await ui.unmount()
})

test('close mission sends a closure report that marks the mission closed for archiving', async ($, on) => {
  engine(on)
  on('audio.play', () => ({ value: undefined }))
  const sent: string[] = []
  on('prompt.submit', (_: unknown, e: { text: string }) => { sent.push(e.text); return { text: e.text } })
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(pane('starfleet-console', 'desktop'))
  await ui.press({ key: 'closure' })
  await new Promise(done => setTimeout(done, 20))
  const closure = sent.find(t => t.includes('CLOSURE REPORT'))
  expect(closure).toContain('closed = true')
  expect(closure).toContain('openItems')
  expect(closure).toContain('starfleet_records')
  expect(closure).toContain('Safe to archive')
  // Work for another project is sorted out with the captain's OK and filed as a note on that project
  expect(closure).toContain('sort it by project')
  expect(closure).toContain('AskUserQuestion')
  expect(closure).toContain('nothing moves without a tick')
  expect(closure).toContain('collection "notes"')
  await ui.unmount()
})

test('close mission refreshes the project overview, asking first only if the captain edited it', async ($, on) => {
  const store = engine(on, undefined, undefined, { cwd: '/Users/cap/harbor' })
  store.projectMap = { harbor: 'Project Harbor' }
  on('audio.play', () => ({ value: undefined }))
  const sent: string[] = []
  on('prompt.submit', (_: unknown, e: { text: string }) => { sent.push(e.text); return { text: e.text } })
  await $.session.start({ cwd: '/Users/cap/harbor', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(pane('starfleet-console', 'desktop'))
  await ui.press({ key: 'closure' })
  await new Promise(done => setTimeout(done, 20))
  await ui.unmount()
  const closure = sent.find(t => t.includes('CLOSURE REPORT'))!
  // The project comes through the map, and its doc id is the hub's slug of it
  expect(closure).toContain('"project-harbor" in the hub collection "reports"')
  expect(closure).toContain('every doc whose project is "Project Harbor"')
  // A hub Save drops writtenAt, so a missing or older stamp means the captain's words: ask, keep first
  expect(closure).toContain('no writtenAt')
  expect(closure).toContain('"Keep my overview" first')
  expect(closure).toContain('same AskUserQuestion call')
  expect(closure).toMatch(/writtenAt: \d+/)
  expect(closure).toContain('Overview refreshed.')
})

test('a report id is the hub\'s slug of the project name', () => {
  expect(reportId('Project Harbor')).toBe('project-harbor')
  expect(reportId('Starfleet mod')).toBe('starfleet-mod')
  expect(reportId('Voyager')).toBe('voyager')
  expect(reportId('')).toBe('mission')
})

test('a project that leaves the decks keeps its sprite until a newcomer needs it', async ($, on) => {
  const store = engine(on)
  // Projects that left the decks hold every sprite
  const sprites = SPRITE_ORDER
  store.crewAssign = Object.fromEntries(sprites.map((s, i) => [`/Users/cap/archived-${i}`, s]))
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  const run = $.command.run as (input: { command: string; args: string }) => Promise<unknown>
  await run({ command: 'crew', args: '' })
  const crew = store.crew as { path: string; sprite: string }[]
  expect(crew.length).toBe(2)
  expect(new Set(crew.map(c => c.sprite)).size).toBe(2)
  // The two newcomers took two sprites back; the others keep theirs for when they return
  const assign = store.crewAssign as Record<string, string>
  expect(Object.keys(assign).length).toBe(SPRITE_ORDER.length)
  for (const c of crew) expect(assign[c.path]).toBe(c.sprite)
})

test('a project that left keeps its sprite while free ones remain', async ($, on) => {
  const store = engine(on)
  store.crewAssign = { '/Users/cap/archived-0': 'worf' }
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  await ($.command.run as (input: { command: string; args: string }) => Promise<unknown>)({ command: 'crew', args: '' })
  expect((store.crew as { sprite: string }[]).map(c => c.sprite)).not.toContain('worf')
  expect((store.crewAssign as Record<string, string>)['/Users/cap/archived-0']).toBe('worf')
})

test('project folders with spaces or underscores join the crew', async ($, on) => {
  // ~/.claude/projects turns "Side Work" and "field_notes" into dashes; only the real names exist
  const real = new Set(['/Users', '/Users/cap', '/Users/cap/MOD', '/Users/cap/Side Work', '/Users/cap/field_notes'])
  const dir = (name: string) => ({ name, kind: 'dir', size: 0, mtimeMs: Date.now(), isLink: false })
  const store = engine(on, undefined, undefined, {
    exists: (_, e) => ({ value: real.has(e.path) }),
    list: (_, e) => ({
      value: e.path.endsWith('/.claude/projects') ? [dir('-Users-cap-MOD'), dir('-Users-cap-Side-Work'), dir('-Users-cap-field-notes')]
        : e.path === '/Users/cap' ? [dir('MOD'), dir('Side Work'), dir('field_notes')]
        : [],
    }),
  })
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  await ($.command.run as (input: { command: string; args: string }) => Promise<unknown>)({ command: 'crew', args: '' })
  const paths = (store.crew as { path: string }[]).map(c => c.path)
  expect(paths).toContain('/Users/cap/Side Work')
  expect(paths).toContain('/Users/cap/field_notes')
})

test('projects archived in the app leave the decks', async ($, on) => {
  const store = engine(on)
  // old-app has only archived sessions; MOD has a live one
  const sessions = [
    { cwd: '/Users/cap/old/app', isArchived: true },
    { cwd: '/Users/cap/MOD', isArchived: true },
    { cwd: '/Users/cap/MOD', isArchived: false },
  ]
  on('mcp.call', () => ({ value: { content: [{ type: 'text', text: JSON.stringify(sessions) }], isError: false } }))
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  const run = $.command.run as (input: { command: string; args: string }) => Promise<unknown>
  await run({ command: 'crew', args: '' })
  const crew = store.crew as { path: string }[]
  expect(crew.map(c => c.path)).toEqual(['/Users/cap/MOD'])
})

test('each chat in a crew project gets that crew member\'s emoji in front of its name', async ($, on) => {
  const store = engine(on)
  const titles: Record<string, string> = {}
  const sessions = [
    { sessionId: 'a', title: '🟧 Old tag from before', cwd: '/Users/cap/MOD', isArchived: false },
    { sessionId: 'b', title: 'Archived chat', cwd: '/Users/cap/MOD', isArchived: true },
    { sessionId: 'c', title: 'Not a crew project', cwd: '/Users/cap/elsewhere', isArchived: false },
    // Its project left the decks and its sprite went to someone else: the old emoji comes off
    { sessionId: 'd', title: '🟨 Departed project', cwd: '/Users/cap/gone', isArchived: false },
  ]
  on('mcp.call', (_: unknown, e: { tool: string; args: { session_id?: string; title?: string } }) => {
    if (e.tool === 'set_session_title') titles[e.args.session_id!] = e.args.title!
    const body = e.tool === 'get_session' ? { sessionId: 'local_self', title: 'This chat', cwd: '/Users/cap/MOD/.claude/worktrees/x' } : sessions
    return { value: { content: [{ type: 'text', text: JSON.stringify(body) }], isError: false } }
  })
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  await ($.command.run as (input: { command: string; args: string }) => Promise<unknown>)({ command: 'crew', args: '' })
  const sprite = (store.crewAssign as Record<string, string>)['/Users/cap/MOD']
  expect(sprite).toBe('picard')
  expect(titles).toEqual({ a: '🟥 Old tag from before', d: 'Departed project', self: '🟥 This chat' })
  // The crew decks list the same emoji
  const tree = JSON.stringify(await $.ui.render(pane('starfleet-crew', 'terminal')))
  expect(tree).toContain('🟥')
})

test('the shields deny a destructive Bash call with the reason, and let safe ones through', async ($, on) => {
  engine(on)
  on('tool.call', () => ({ result: 'ok' }))
  on('audio.play', () => ({ value: undefined }))
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  const tools = $.tool as unknown as { call: (input: object) => Promise<{ deny?: string }> }
  const blocked = ['rm -rf build', 'rm -fr build', 'rm -r -f build', 'rm --recursive --force x', 'cd a && rm -Rf b', 'git push -f origin main', 'git push --force-with-lease', 'git reset --hard']
  for (const command of blocked) expect((await tools.call({ tool: 'Bash', command }))?.deny).toBeTruthy()
  expect((await tools.call({ tool: 'Bash', command: 'git reset --hard' }))?.deny).toContain('(git reset --hard)')
  for (const command of ['rm -r build', 'rm -f a.txt', 'git push origin main', 'ls -rf', 'echo "rm -rf x"'])
    expect((await tools.call({ tool: 'Bash', command }))?.deny).toBeFalsy()
})

test('a worktree session keeps its project aboard', async ($, on) => {
  const store = engine(on)
  const sessions = [
    { cwd: '/Users/cap/old/app', isArchived: true },
    { cwd: '/Users/cap/old/app/.claude/worktrees/feature-x', isArchived: false },
  ]
  on('mcp.call', () => ({ value: { content: [{ type: 'text', text: JSON.stringify(sessions) }], isError: false } }))
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  await ($.command.run as (input: { command: string; args: string }) => Promise<unknown>)({ command: 'crew', args: '' })
  expect((store.crew as { path: string }[]).map(c => c.path)).toContain('/Users/cap/old/app')
})

test('log writes after /clear are tracked for cleanup', async ($, on) => {
  const store = engine(on)
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  const run = $.command.run as (input: { command: string; args: string }) => Promise<unknown>
  await run({ command: 'log', args: 'before clear' })
  // /clear: the process goes on under a new id, with no session.start
  sessionId = 'sess-2'
  await run({ command: 'log', args: 'after clear' })
  sessionId = 'sess-1'
  expect(store.logSessions).toEqual(['sess-2', 'sess-1'])
  expect(JSON.stringify(store['log:sess-2'])).toContain('after clear')
})

test('a stood-down memory alert stays down until context climbs past 90% again', async ($, on) => {
  engine(on)
  on('audio.play', () => ({ value: undefined }))
  on('session.measure', () => ({ changed: [] }))
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  const measure = $.session.measure as unknown as (input: object) => Promise<unknown>
  const context = (percent: number) => ({ context: { tokens: percent * 2000, window: 200000, percent } })
  await measure(context(92))
  await ($.command.run as (input: { command: string; args: string }) => Promise<unknown>)({ command: 'red-alert', args: '' })
  await measure(context(93))
  const band = await $.ui.mount({ plugin: 'starfleet', component: 'AbovePrompt', requestId: 'band', surface: 'desktop', props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 80, scroll: { offset: 0, bodyRows: 6 }, view: {} } } as const)
  expect(await band.find({ type: 'Text', text: /RED ALERT/ })).toBeFalsy()
  await band.unmount()
})

test('focus mode shows only the comms badge, and hailing opens the console', async ($, on) => {
  const store = engine(on)
  on('audio.play', () => ({ value: undefined }))
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  const run = $.command.run as (input: { command: string; args: string }) => Promise<unknown>

  for (const surface of ['desktop', 'terminal'] as const) {
    let ui = await $.ui.mount(pane('starfleet-console', surface))
    await ui.press({ key: 'focus' })
    expect(store.focusMode).toBe(true)
    expect(await ui.find({ type: 'Button', key: 'hail' })).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'open-log' })).toBeFalsy()
    expect(await ui.find({ type: 'Text', text: /CONDITION|BORG/ })).toBeFalsy()
    if (surface === 'desktop') {
      // A picture can't take a click (a hidden checkbox was tried; the app strips it), so Pause is a
      // button beside Hail Starfleet. Hovering still stills the badge for a moment
      const badge = String((await ui.find({ type: 'Svg' }))?.props.source)
      expect(badge).toContain('svg:hover :is(.badge,.wv,.gl,.halo,.cur){animation-play-state:paused}')
      expect(badge).not.toMatch(/<script|onclick|<input/i)
      expect((await ui.findAll({ type: 'Button' })).map(b => (b as { key?: string }).key ?? b.props.key)).toEqual(['hail', 'pause'])
      // Pause stills the badge and is remembered; Play brings it back
      expect((await ui.find({ type: 'Button', key: 'pause' }))?.props.label).toBe('⏸ Pause')
      await ui.press({ key: 'pause' })
      expect(store.badgePaused).toBe(true)
      expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toContain('animation:none')
      expect((await ui.find({ type: 'Button', key: 'pause' }))?.props.label).toBe('▶ Play')
      await ui.press({ key: 'pause' })
      expect(store.badgePaused).toBe(false)
    }
    await ui.press({ key: 'hail' })
    expect(store.focusMode).toBe(false)
    expect(await ui.find({ type: 'Button', key: 'open-log' })).toBeTruthy()
    await ui.unmount()
  }

  // /starfleet focus enters it; a plain /starfleet leaves it
  await run({ command: 'starfleet', args: 'focus' })
  expect(store.focusMode).toBe(true)
  await run({ command: 'starfleet', args: '' })
  expect(store.focusMode).toBe(false)
})

test('every sprite holds its deck while Claude works, so the crew picture never changes mid-turn', async ($, on) => {
  engine(on)
  let finishTool = () => {}
  on('tool.call', () => new Promise(done => { finishTool = () => done({ result: {} }) }))
  on('turn.start', ((_: unknown, e: unknown) => e) as never)
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  await ($.command.run as (input: { command: string; args: string }) => Promise<unknown>)({ command: 'crew', args: '' })
  const deckOfMod = () => deckOn($, 'MOD')
  // The scan put MOD (uncommitted changes) in engineering
  expect(await deckOfMod()).toBe('engineering')
  await ($.turn as unknown as { start: (input: object) => Promise<unknown> }).start({ text: 'scan', turnId: 't1' })
  const running = ($.tool as unknown as { call: (input: object) => Promise<unknown> }).call({ tool: 'Grep', pattern: 'warp' })
  await new Promise(r => (globalThis as unknown as { setTimeout: (f: unknown, ms: number) => void }).setTimeout(r, 0))
  // A Grep would be science, but mid-turn the sprite stays where the turn found it
  expect(await deckOfMod()).toBe('engineering')
  finishTool()
  await running
  expect(await deckOfMod()).toBe('engineering')
})

test('the mission record keeps models, plugins, skills, files and the warp core', async ($, on) => {
  engine(on)
  on('tool.call', () => ({ result: 'ok' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  await callTool($, { tool: 'Skill', skill: 'superpowers:brainstorming' })
  await callTool($, { tool: 'Agent', description: 'x', prompt: 'x', subagent_type: 'starfleet:away-team' })
  await callTool($, { tool: 'mcp__plugin_canva_canva__create-design' })
  await callTool($, { tool: 'Write', file_path: '/Users/cap/MOD/b.ts', content: 'b' })
  await ($.turn.complete as (e: unknown) => Promise<unknown>)({ durationMs: 5000, answer: 'Done.', isAborted: false })
  const records = JSON.parse(String((await callTool($, { tool: 'mcp__starfleet__starfleet_records' }) as { result: unknown }).result))
  const m = records.missions.find((x: { id: string }) => x.id === sessionId)
  expect(m.models).toEqual(['claude-opus-5-5'])
  expect(m.endedAt).toBeGreaterThan(0)
  expect(m.peakContext).toBe(75)
  expect(m.skills).toEqual(['superpowers:brainstorming'])
  expect(m.agents).toEqual(['starfleet:away-team'])
  expect(m.plugins).toEqual(expect.arrayContaining(['starfleet', 'canva', 'superpowers']))
  expect(m.files).toContain('/Users/cap/MOD/b.ts')
  expect(m.warpCore.orders).toBe(4)
  expect(m.tools.Write).toBe(1)
})

test('a picked cloud repo comes aboard from GitHub, and unpicking sends it ashore', async ($, on) => {
  const pushed = new Date(Date.now() - 3600000).toISOString()
  const store = engine(on, (_: unknown, e: { argv: string[] }) => {
    const args = e.argv.slice(1).join(' ')
    if (args.startsWith('repo list')) return { value: { exitCode: 0, stdout: JSON.stringify([{ nameWithOwner: 'cap/Voyager', pushedAt: pushed }, { nameWithOwner: 'cap/Other', pushedAt: pushed }]), stderr: '' } }
    if (args.startsWith('repo view')) return { value: { exitCode: 0, stdout: JSON.stringify({ pushedAt: pushed }), stderr: '' } }
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  await ($.command.run as (input: { command: string; args: string }) => Promise<unknown>)({ command: 'crew', args: '' })
  await new Promise(done => setTimeout(done, 10))
  const ui = await $.ui.mount(pane('starfleet-crew', 'desktop'))
  // Cloud repos have their own page in Manage crew
  await ui.press({ key: 'manage-cloud' })
  const pick = await ui.find({ type: 'Button', key: 'cloud-cap/Voyager' })
  expect(pick).toBeTruthy()
  await ui.press({ key: 'cloud-cap/Voyager' })
  const crew = store.crew as { project: string; deck: string; status: string }[]
  const vu = crew.find(c => c.project === 'Voyager')
  expect(vu?.deck).toBe('bridge')
  expect(vu?.status).toContain('Cloud · pushed 1h ago')
  expect(crew.some(c => c.project === 'Other')).toBe(false)
  await ui.press({ key: 'cloud-cap/Voyager' })
  expect((store.crew as { project: string }[]).some(c => c.project === 'Voyager')).toBe(false)
  await ui.unmount()
})

test('the cloud crew tool sends a repo ashore', async ($, on) => {
  const store = engine(on, () => ({ value: { exitCode: 0, stdout: JSON.stringify({ pushedAt: new Date().toISOString() }), stderr: '' } }))
  on('tool.call', () => ({ result: 'ok' }))
  store.cloudCrew = ['cap/Voyager']
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  const ran = await callTool($, { tool: 'mcp__starfleet__starfleet_cloud_crew', repo: 'cap/voyager', aboard: false }) as { result: string }
  expect(ran.result).toContain('now ashore')
  expect(store.cloudCrew).toEqual([])
  expect((store.crew as { project: string }[]).some(c => c.project === 'Voyager')).toBe(false)
})

test('the crew tool marks a folder as not a project, and brings it back', async ($, on) => {
  const store = engine(on)
  on('tool.call', () => ({ result: 'ok' }))
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  await ($.command.run as (input: { command: string; args: string }) => Promise<unknown>)({ command: 'crew', args: '' })
  const hid = await callTool($, { tool: 'mcp__starfleet__starfleet_crew', project: 'mod', aboard: false }) as { result: string }
  expect(hid.result).toContain('left the crew')
  expect(store.crewHidden).toEqual(['/Users/cap/MOD'])
  expect((store.crew as { path: string }[]).map(c => c.path)).not.toContain('/Users/cap/MOD')
  // Its character is freed for someone else
  expect(Object.keys(store.crewAssign as object)).not.toContain('/Users/cap/MOD')
  const back = await callTool($, { tool: 'mcp__starfleet__starfleet_crew', project: 'MOD', aboard: true }) as { result: string }
  expect(back.result).toContain('aboard')
  expect(store.crewHidden).toEqual([])
  expect((store.crew as { path: string }[]).map(c => c.path)).toContain('/Users/cap/MOD')
})

test('Manage crew removes and adds a project after asking inline, by its name', async ($, on) => {
  const store = engine(on)
  const asked: string[] = []
  on('tool.call', (_: unknown, e: { tool: string }) => {
    if (e.tool === 'AskUserQuestion') asked.push('asked')
    return { result: 'ok' }
  })
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  await ($.command.run as (input: { command: string; args: string }) => Promise<unknown>)({ command: 'crew', args: '' })
  const ui = await $.ui.mount(pane('starfleet-crew', 'desktop'))
  await ui.press({ key: 'manage-add' })

  // Remove asks inline, naming it (never the app's question box); Keep changes nothing
  await ui.press({ key: 'crew-drop-/Users/cap/old/app' })
  expect(await ui.find({ type: 'Text', text: /Remove app from the crew\?/ })).toBeTruthy()
  await ui.press({ key: 'crew-no' })
  expect(store.crewHidden ?? []).toEqual([])
  await ui.press({ key: 'crew-drop-/Users/cap/old/app' })
  expect((await ui.find({ type: 'Button', key: 'crew-yes' }))?.text).toBe('Remove app')
  await ui.press({ key: 'crew-yes' })
  expect(store.crewHidden).toEqual(['/Users/cap/old/app'])
  expect((store.crew as { path: string }[]).map(c => c.path)).not.toContain('/Users/cap/old/app')

  // Add: the removed folder is offered back under Not aboard, and ← brings it on at once
  await ui.press({ key: 'manage-add' })
  expect((await ui.find({ type: 'Button', key: 'crew-pick-/Users/cap/old/app' }))?.text).toBe('←')
  expect((await ui.find({ type: 'Button', key: `crew-drop-/Users/cap/MOD` }))?.text).toBe('→')
  await ui.press({ key: 'crew-pick-/Users/cap/old/app' })
  expect(store.crewHidden).toEqual([])
  // Undoing a removal of a recent project doesn't pin it aboard for good
  expect(store.crewAdded ?? []).toEqual([])
  expect((store.crew as { path: string }[]).map(c => c.path)).toContain('/Users/cap/old/app')

  // Other folder: a typed path joins too
  await ui.press({ key: 'manage-add' })
  await ui.press({ key: 'crew-other' })
  await $.ui.input({ plugin: 'starfleet', key: 'crew-other-path', text: '~/fresh' })
  expect(asked).toEqual([])
  expect(store.crewAdded).toEqual(['/Users/cap/fresh'])
  expect((store.crew as { path: string }[]).map(c => c.path)).toContain('/Users/cap/fresh')
  await ui.unmount()
})

test('Not aboard folders can be pruned off the list, and adding one by path brings it back', async ($, on) => {
  const store = engine(on)
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  await ($.command.run as (input: { command: string; args: string }) => Promise<unknown>)({ command: 'crew', args: '' })
  const ui = await $.ui.mount(pane('starfleet-crew', 'desktop'))
  await ui.press({ key: 'manage-add' })
  await ui.press({ key: 'crew-drop-/Users/cap/old/app' })
  await ui.press({ key: 'crew-yes' })

  // ✕ prunes at once: off the list and off the crew, with the removal folded into the prune
  await ui.press({ key: 'manage-add' })
  expect((await ui.find({ type: 'Button', key: 'crew-prune-/Users/cap/old/app' }))?.text).toBe('✕')
  await ui.press({ key: 'crew-prune-/Users/cap/old/app' })
  expect(store.crewPruned).toEqual(['/Users/cap/old/app'])
  expect(store.crewHidden).toEqual([])
  expect(await ui.find({ type: 'Button', key: 'crew-pick-/Users/cap/old/app' })).toBeFalsy()
  expect((store.crew as { path: string }[]).map(c => c.path)).not.toContain('/Users/cap/old/app')

  // Typing its path under Add another folder unprunes it and brings it aboard
  await ui.press({ key: 'crew-other' })
  await $.ui.input({ plugin: 'starfleet', key: 'crew-other-path', text: '~/old/app' })
  expect(store.crewPruned).toEqual([])
  expect((store.crew as { path: string }[]).map(c => c.path)).toContain('/Users/cap/old/app')
  await ui.unmount()
})

test('the service record shows its rank as a badge, with a wreath only at flag rank', () => {
  const ensign = rankBadgeSvg(rankOf(0))
  const admiral = rankBadgeSvg(rankOf(100))
  expect(ensign).toContain('>ENSIGN</text>')
  expect(ensign).not.toContain('<ellipse')
  expect(admiral).toContain('>ADMIRAL</text>')
  expect(admiral.match(/<ellipse/g)?.length).toBe(10)
  // One star per pip, and no animation for a redraw to restart
  expect(admiral.match(/M0-9/g)?.length).toBe(5)
  expect(admiral).not.toContain('animation')
  // Small fixed art, like the pips, so it fits a narrow console
  expect(BADGE_W).toBeLessThanOrEqual(160)
})

test('a /log note starting with a category word and a colon is filed under it', () => {
  expect(splitCategory('idea: cache the crew scan')).toEqual({ category: 'idea', text: 'cache the crew scan' })
  expect(splitCategory('Bug:console shivers')).toEqual({ category: 'bug', text: 'console shivers' })
  expect(splitCategory('to-do: re-enable baseplate')).toEqual({ category: 'todo', text: 're-enable baseplate' })
  expect(splitCategory('plain note: with a colon later')).toEqual({ category: 'note', text: 'plain note: with a colon later' })
  expect(LOG_CATEGORIES.map(c => c.id)).toEqual(['note', 'idea', 'bug', 'decision', 'todo'])
})

test('log entries carry a category: picked in the log tab, filtered there, and sent to the hub', async ($, on) => {
  const toasts: string[] = []
  const store = engine(on, undefined, undefined, { toasts })
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  const run = $.command.run as (input: { command: string; args: string }) => Promise<unknown>
  // /log with a category word files it there, and the hub doc carries it
  await run({ command: 'log', args: 'idea: cache the crew scan' })
  const saved = () => store['log:sess-1'] as { text: string; category: string }[]
  expect(saved()[0]).toMatchObject({ text: 'cache the crew scan', category: 'idea' })
  expect(toasts.some(t => t.startsWith('💡 Idea logged'))).toBe(true)
  expect((store.hubPending as { doc: { category: string } }[])[0]!.doc.category).toBe('idea')

  // The tab: Note is picked to start; a pick files the next entry, then it goes back to Note
  const tab = await $.ui.mount(pane('starfleet-log', 'desktop'))
  expect((await tab.find({ type: 'Button', key: 'cat-note' }))?.props.variant).toBe('primary')
  expect((await tab.find({ type: 'Button', key: 'cat-bug' }))?.props.variant).toBe('secondary')
  await tab.press({ key: 'cat-bug' })
  expect((await tab.find({ type: 'Button', key: 'cat-bug' }))?.props.variant).toBe('primary')
  await $.ui.input({ plugin: 'starfleet', key: 'log-0', text: 'console shivers' })
  expect(saved()[0]).toMatchObject({ text: 'console shivers', category: 'bug' })
  expect((await tab.find({ type: 'Button', key: 'cat-note' }))?.props.variant).toBe('primary')

  // A section per category that has entries; its header folds it, and the fold is remembered
  expect((await tab.find({ type: 'Button', key: 'log-sec-bug' }))?.props.label).toBe('Bug (1)')
  expect(await tab.find({ type: 'Button', key: 'log-sec-idea' })).toBeTruthy()
  expect(await tab.find({ type: 'Button', key: 'log-sec-decision' })).toBeFalsy()
  expect(await tab.find({ type: 'Text', text: 'console shivers' })).toBeTruthy()
  await tab.press({ key: 'log-sec-bug' })
  expect(store.logFolded).toEqual({ bug: true })
  expect(await tab.find({ type: 'Text', text: 'console shivers' })).toBeFalsy()
  expect(await tab.find({ type: 'Text', text: 'cache the crew scan' })).toBeTruthy()
  await tab.press({ key: 'log-sec-bug' })
  expect(await tab.find({ type: 'Text', text: 'console shivers' })).toBeTruthy()
  await tab.unmount()

  // The console lists no entries, and its log button has no hotkey, so its black text shows
  const ui = await $.ui.mount(pane('starfleet-console', 'desktop'))
  expect(await ui.find({ type: 'Text', text: /console shivers/ })).toBeFalsy()
  const openLog = await ui.find({ type: 'Button', key: 'open-log' })
  expect(openLog?.props.hotkey).toBeUndefined()
  // The app's own filled button: the desktop ignores a text color set on a mod's button
  expect(openLog?.props.variant).toBe('primary')
  expect(openLog?.props.plain).toBeUndefined()
  // Left-aligned with the hint under it, not centered
  const tree = JSON.stringify(await $.ui.render(pane('starfleet-console', 'desktop')))
  expect(tree).toMatch(/"alignItems":"flex-start","rowGap":1[^]*?"key":"open-log"/)
  await ui.unmount()
})

test('an entry saved before categories reads, and syncs, as a note', async ($, on) => {
  const store = engine(on)
  store['log:sess-1'] = [{ id: 'log-old', stardate: '1027.26', text: 'old note', at: Date.now(), project: 'MOD' }]
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  const ran = await callTool($, { tool: 'mcp__starfleet__starfleet_records' }) as { result: string }
  expect(ran.result).toContain('"category": "note"')
})

test('Band off hides the strip above the prompt, from the console button or /band, and is remembered', async ($, on) => {
  const store = engine(on)
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  // On: the ship glides while Claude works
  let strip = await $.ui.mount(band('desktop', true))
  expect(await strip.find({ type: 'Svg' })).toBeTruthy()
  await strip.unmount()
  // The console button turns it off
  const ui = await $.ui.mount(pane('starfleet-console', 'desktop'))
  expect((await ui.find({ type: 'Button', key: 'band' }))?.props.label).toBe('Band: on')
  await ui.press({ key: 'band' })
  expect(store.bandHidden).toBe(true)
  expect((await ui.find({ type: 'Button', key: 'band' }))?.props.label).toBe('Band: off')
  await ui.unmount()
  strip = await $.ui.mount(band('desktop', true))
  expect(await strip.find({ type: 'Svg' })).toBeFalsy()
  // Nothing of ours even at 75% context: the warning stays in the console and the core pane
  expect(await strip.find({ type: 'Text', text: /ASSIMILATION/ })).toBeFalsy()
  await strip.unmount()
  // /band on brings it back
  const run = $.command.run as (input: { command: string; args: string }) => Promise<{ text?: string }>
  expect((await run({ command: 'band', args: 'on' })).text).toContain('Band on')
  expect(store.bandHidden).toBe(false)
  strip = await $.ui.mount(band('desktop', true))
  expect(await strip.find({ type: 'Svg' })).toBeTruthy()
  await strip.unmount()
})

test('a chat opened in the home folder puts the home folder on the crew like any project', async ($, on) => {
  const entry = (name: string, age: number) => ({ name, kind: 'dir' as const, size: 0, mtimeMs: Date.now() - age, isLink: false })
  const store = engine(on, undefined, undefined, {
    list: (_: unknown, e: { path: string }) => e.path.endsWith('starfleet-live') ? { value: [] } : { value: [entry('-Users-cap', 0), entry('-Users-cap-MOD', 1000)] },
  })
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  await ($.command.run as (input: { command: string; args: string }) => Promise<unknown>)({ command: 'crew', args: '' })
  const crew = (store.crew as { path: string; project: string }[]).map(c => c.path)
  expect(crew).toContain('/Users/cap')
  expect(crew).toContain('/Users/cap/MOD')
})

test('a log entry saved in the old stardate format reads in the new one', async ($, on) => {
  const store = engine(on)
  const at = new Date(2026, 9, 27, 10, 54).getTime()
  store['log:sess-1'] = [{ id: 'log-old', stardate: '2026.1027.1054', text: 'old note', at, project: 'MOD' }]
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  const ran = await callTool($, { tool: 'mcp__starfleet__starfleet_records' }) as { result: string }
  expect(ran.result).toContain('"stardate": "1027.26"')
  expect(ran.result).not.toContain('2026.1027.1054')
})

test('About opens a pane that names every part and what it connects to', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount(pane('starfleet-console', surface))
    opened.length = 0
    await ui.press({ key: 'about' })
    expect(opened).toContain('starfleet-about')
    await ui.unmount()
    const about = await $.ui.mount(pane('starfleet-about', surface))
    for (const part of ['Crew decks', 'Captain', 'warp core', 'Dilithium', 'Shields', 'Starfleet Command hub', '/translator']) expect(await about.find({ type: 'Text', text: new RegExp(part) })).toBeTruthy()
    expect((await about.findAll({ type: 'Text', text: /^↔/ })).length).toBeGreaterThan(8)
    expect(JSON.stringify(await about.findAll({ type: 'Text' }))).not.toMatch(/—|–/)
    await about.unmount()
  }
})

test('added folders never push the crew past 11 aboard, and adding a 12th is refused', async ($, on) => {
  const full = CREW_MAX
  expect(full).toBe(11)
  const store = engine(on)
  on('tool.call', () => ({ result: 'ok' }))
  store.crewAdded = Array.from({ length: full + 1 }, (_, i) => `/Users/cap/added-${i}`)
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  await ($.command.run as (input: { command: string; args: string }) => Promise<unknown>)({ command: 'crew', args: '' })
  const crew = store.crew as { sprite: string }[]
  expect(crew.length).toBeLessThanOrEqual(full)
  expect(new Set(crew.map(c => c.sprite)).size).toBe(crew.length)
  store.crewAdded = Array.from({ length: full }, (_, i) => `/Users/cap/added-${i}`)
  const ran = await callTool($, { tool: 'mcp__starfleet__starfleet_crew', project: '/Users/cap/old/app', aboard: true }) as { result: string }
  expect(ran.result).toContain('full')
  expect((store.crewAdded as string[]).length).toBe(full)
})

test('Claude adds a folder the mod has never seen only after the captain says so, and git runs with fsmonitor off', async ($, on) => {
  const argvs: string[][] = []
  const store = engine(on, (_, e) => { argvs.push(e.argv); return { value: { exitCode: 0, stdout: '', stderr: '' } } })
  let answer = 'Keep it off'
  const asked: string[] = []
  on('tool.call', (_: unknown, e: { tool: string; questions?: { question: string }[] }) => {
    if (e.tool !== 'AskUserQuestion') return { result: 'ok' }
    const question = e.questions![0]!.question
    asked.push(question)
    return { result: { questions: e.questions, answers: { [question]: answer } } }
  })
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  // Keep it off (the default) adds nothing
  const kept = await callTool($, { tool: 'mcp__starfleet__starfleet_crew', project: '/Users/cap/cloned/stranger', aboard: true }) as { result: string }
  expect(asked[0]).toContain('/Users/cap/cloned/stranger')
  expect(kept.result).toContain('kept stranger off')
  expect((store.crewAdded as string[] | undefined) ?? []).not.toContain('/Users/cap/cloned/stranger')
  // Add folder brings it aboard
  answer = 'Add folder'
  await callTool($, { tool: 'mcp__starfleet__starfleet_crew', project: '/Users/cap/cloned/stranger', aboard: true })
  expect(store.crewAdded as string[]).toContain('/Users/cap/cloned/stranger')
  // A folder the mod already knows comes back with no question
  await callTool($, { tool: 'mcp__starfleet__starfleet_crew', project: 'MOD', aboard: false })
  await callTool($, { tool: 'mcp__starfleet__starfleet_crew', project: 'MOD', aboard: true })
  expect(asked.length).toBe(2)
  // Taking an unknown folder off first can't sneak it past the question
  answer = 'Keep it off'
  const off = await callTool($, { tool: 'mcp__starfleet__starfleet_crew', project: '/Users/cap/cloned/other', aboard: false }) as { result: string }
  expect(off.result).toContain("isn't on the crew")
  expect((store.crewHidden as string[] | undefined) ?? []).not.toContain('/Users/cap/cloned/other')
  await callTool($, { tool: 'mcp__starfleet__starfleet_crew', project: '/Users/cap/cloned/other', aboard: true })
  expect(asked.length).toBe(3)
  expect(store.crewAdded as string[]).not.toContain('/Users/cap/cloned/other')
  // Nor can a path already on the hidden list from before
  store.crewHidden = [...((store.crewHidden as string[] | undefined) ?? []), '/Users/cap/cloned/planted']
  await callTool($, { tool: 'mcp__starfleet__starfleet_crew', project: '/Users/cap/cloned/planted', aboard: true })
  expect(asked.length).toBe(4)
  // Every git call the crew scan makes switches off a repo's fsmonitor program
  await ($.command.run as (input: { command: string; args: string }) => Promise<unknown>)({ command: 'crew', args: '' })
  const gits = argvs.filter(a => a[0] === 'git')
  expect(gits.length).toBeGreaterThan(0)
  for (const argv of gits) expect(argv.slice(0, 3)).toEqual(['git', '-c', 'core.fsmonitor=false'])
})

test('with no hub yet, Set up my hub has Claude publish one once, and the button goes when the hub is set', async ($, on) => {
  const store = engine(on)
  const sent: string[] = []
  on('prompt.submit', (_: unknown, e: { text: string }) => { sent.push(e.text); return { text: e.text } })
  on('tool.call', () => ({ result: 'ok' }))
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(pane('starfleet-console', 'desktop'))
  await ui.press({ key: 'setup-hub' })
  expect(sent.length).toBe(1)
  expect(sent[0]).toContain('assets/hub.html')
  expect(sent[0]).toContain('starfleet_set_hub')
  // A second press while Claude works on it publishes nothing more
  await ui.press({ key: 'setup-hub' })
  expect(sent.length).toBe(1)
  expect((await ui.find({ type: 'Button', key: 'setup-hub' }))?.props.label).toBe('Setting up your hub…')
  // Once the hub is saved, the button is gone
  await callTool($, { tool: 'mcp__starfleet__starfleet_set_hub', url: 'https://claude.ai/artifact/hub1' })
  expect(store.hubUrl).toBe('https://claude.ai/artifact/hub1')
  expect(await ui.find({ type: 'Button', key: 'setup-hub' })).toBeFalsy()
  await ui.unmount()
})

test('an added folder that no longer exists leaves its crew slot free', async ($, on) => {
  const dir = (name: string) => ({ name, kind: 'dir', size: 0, mtimeMs: Date.now(), isLink: false })
  const store = engine(on, undefined, undefined, {
    exists: (_, e) => ({ value: e.path !== '/Users/cap/gone' }),
    list: (_, e) => ({ value: e.path.endsWith('/.claude/projects') ? Array.from({ length: 8 }, (_, i) => dir(`-Users-cap-p${i}`)) : [] }),
  })
  store.crewAdded = ['/Users/cap/gone']
  await $.session.start({ cwd: '/Users/cap/p0', surface: 'desktop', isInteractive: true })
  await ($.command.run as (input: { command: string; args: string }) => Promise<unknown>)({ command: 'crew', args: '' })
  expect((store.crew as unknown[]).length).toBe(8)
})

test('the crew scan skips temp and scratch project dirs without decoding them', async ($, on) => {
  const looked: string[] = []
  const dir = (name: string) => ({ name, kind: 'dir', size: 0, mtimeMs: Date.now(), isLink: false })
  engine(on, undefined, undefined, {
    exists: (_, e) => { looked.push(e.path); return { value: true } },
    list: (_, e) => ({ value: e.path.endsWith('/.claude/projects') ? [dir('-Users-cap-MOD'), ...Array.from({ length: 20 }, (_, i) => dir(`-private-tmp-claude-501-scratch-${i}`))] : [] }),
  })
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  await ($.command.run as (input: { command: string; args: string }) => Promise<unknown>)({ command: 'crew', args: '' })
  expect(looked.filter(p => p.startsWith('/private')).length).toBe(0)
})

test('deleting a log entry also takes it off the hub', async ($, on) => {
  const store = engine(on)
  const sent: string[] = []
  on('prompt.submit', (_: unknown, e: { text: string }) => { sent.push(e.text); return { text: e.text } })
  store.hubUrl = 'https://claude.ai/artifact/hub1'
  store['log:sess-1'] = [{ id: 'log-1', stardate: '1027.26', text: 'typo', at: Date.now(), project: 'MOD' }]
  store['log:sess-1'] = [...store['log:sess-1'] as unknown[], { id: 'log-2', stardate: '1027.26', text: 'also a typo', at: Date.now(), project: 'MOD' }]
  let answer = 'Keep'
  let hubWorks = true
  const asked: string[] = []
  const hub: { action: string; writes?: unknown[]; doc_id?: string }[] = []
  on('tool.call', (_: unknown, e: { tool: string; action?: string; questions?: { question: string }[] }) => {
    if (e.tool === 'ArtifactData') {
      hub.push(e as never)
      if (!hubWorks) return { deny: 'no hub here' }
      return e.action === 'get' ? { result: 'ok', text: '{"id":"log-1","data":{},"version":3}' } : { result: 'ok', text: 'committed' }
    }
    if (e.tool !== 'AskUserQuestion') return { result: 'ok' }
    const question = e.questions![0]!.question
    asked.push(question)
    return { result: { questions: e.questions, answers: { [question]: answer } } }
  })
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(pane('starfleet-log', 'desktop'))
  // Delete asks inline, naming the entry, never in the app's question box; Keep changes nothing;
  // Delete entry removes it here and, with no chat turn, on the hub
  await ui.press({ key: 'del-log-1' })
  expect(await ui.find({ type: 'Text', text: /Delete the log entry "typo"\?/ })).toBeTruthy()
  await ui.press({ key: 'keep-log-1' })
  expect((store['log:sess-1'] as unknown[]).length).toBe(2)
  await ui.press({ key: 'del-log-1' })
  await ui.press({ key: 'confirm-del-log-1' })
  expect(asked).toEqual([])
  expect((store['log:sess-1'] as { id: string }[]).map(e => e.id)).toEqual(['log-2'])
  expect(sent).toEqual([])
  expect(JSON.stringify(hub)).toContain('"collection":"logDeleted","doc_id":"log-1"')
  expect(JSON.stringify(hub)).toContain('"op":"delete","collection":"log","doc_id":"log-1","if_version":3')
  // Where the hub can't be written directly, Claude is asked instead
  hubWorks = false
  await ui.press({ key: 'del-log-2' })
  await ui.press({ key: 'confirm-del-log-2' })
  expect(sent.some(t => t.includes('logDeleted') && t.includes('log-2') && t.includes('hub1'))).toBe(true)
  await ui.unmount()
})

test('a recorded note goes straight to the hub, with no chat turn', async ($, on) => {
  const store = engine(on)
  const sent: string[] = []
  on('prompt.submit', (_: unknown, e: { text: string }) => { sent.push(e.text); return { text: e.text } })
  store.hubUrl = 'https://claude.ai/artifact/hub1'
  const hub: unknown[] = []
  on('tool.call', (_: unknown, e: { tool: string }) => {
    if (e.tool === 'ArtifactData') hub.push(e)
    return { result: 'ok', text: 'committed' }
  })
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  await ($.command.run as (input: { command: string; args: string }) => Promise<unknown>)({ command: 'log', args: 'a thought' })
  expect(sent).toEqual([])
  expect(JSON.stringify(hub)).toContain('"op":"set","collection":"log","doc_id":"log-')
  expect(JSON.stringify(hub)).toContain('"text":"a thought"')
})

test('notes recorded before there is a hub are sent once the hub is set', async ($, on) => {
  const store = engine(on)
  on('prompt.submit', (_: unknown, e: { text: string }) => ({ text: e.text }))
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  await ($.command.run as (input: { command: string; args: string }) => Promise<unknown>)({ command: 'log', args: 'before the hub' })
  expect((store.hubPending as unknown[]).length).toBe(1)
  const ran = await callTool($, { tool: 'mcp__starfleet__starfleet_set_hub', url: 'https://claude.ai/artifact/hub2' }) as { result: string }
  expect(ran.result).toContain('before the hub')
  expect(store.hubPending ?? []).toEqual([])
})

test('a failing test run in a worktree chat puts its project in sickbay', async ($, on) => {
  const store = engine(on, undefined, undefined, { cwd: '/Users/cap/MOD/.claude/worktrees/x' })
  on('tool.call', () => ({ result: { stdout: '', stderr: 'FAIL', interrupted: false }, isError: true }))
  on('audio.play', () => ({ value: undefined }))
  await $.session.start({ cwd: '/Users/cap/MOD/.claude/worktrees/x', surface: 'desktop', isInteractive: true })
  await callTool($, { tool: 'Bash', command: 'npm test' })
  expect((store.health as Record<string, boolean>)['/Users/cap/MOD']).toBe(true)
})

test('a second crew scan reuses decoded project folders', async ($, on) => {
  let looked = 0
  engine(on, undefined, undefined, { exists: () => { looked += 1; return { value: true } } })
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  const run = $.command.run as (input: { command: string; args: string }) => Promise<unknown>
  await run({ command: 'crew', args: '' })
  looked = 0
  await run({ command: 'crew', args: '' })
  // One check per cached folder (it may have moved), not a fresh walk of every path segment
  expect(looked).toBeLessThanOrEqual(2)
})

test('the console never grows a crew list: Manage crew opens its own tab', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  await ($.command.run as (input: { command: string; args: string }) => Promise<unknown>)({ command: 'crew', args: '' })
  const console_ = await $.ui.mount(pane('starfleet-console', 'desktop'))
  if (!(await console_.find({ type: 'Button', key: 'manage-crew' }))) await console_.press({ key: 'sec-crew' })
  expect(await console_.find({ type: 'Button', key: 'crew-add' })).toBeFalsy()
  expect(await console_.find({ type: 'Button', key: 'crew-remove' })).toBeFalsy()
  opened.length = 0
  await console_.press({ key: 'manage-crew' })
  expect(opened).toEqual(['starfleet-crew'])
  await console_.unmount()
})

test('the Crew page lists every project, changes characters only on Save, and benches the rest', async ($, on) => {
  const store = engine(on)
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  await ($.command.run as (input: { command: string; args: string }) => Promise<unknown>)({ command: 'crew', args: '' })
  const crew = () => store.crew as { path: string; sprite: string; project: string }[]
  const [first, second] = crew()
  const ui = await $.ui.mount(pane('starfleet-crew', 'desktop'))
  // Every project is listed at once, with its character's tag, name and project
  for (const c of crew()) expect(await ui.find({ type: 'Text', text: new RegExp(`${SPRITES[c.sprite]!.name}.*${c.project}`) })).toBeTruthy()
  // The bench holds everyone else: the squares first, then the picture tags
  const benched = (await ui.findAll({ type: 'Text' })).map(t => t.text).filter(t => SPRITE_ORDER.some(k => t === `${SPRITES[k]!.emoji} ${SPRITES[k]!.name}`))
  expect(benched).toHaveLength(SPRITE_ORDER.length - crew().length)
  expect(benched).toEqual(SPRITE_ORDER.filter(k => !crew().some(c => c.sprite === k)).map(k => `${SPRITES[k]!.emoji} ${SPRITES[k]!.name}`))

  // ▶ steps to the next free character, skipping the one the second project holds; nothing is saved yet
  await ui.press({ key: `next-${first!.path}` })
  expect(crew().find(c => c.path === first!.path)?.sprite).toBe(first!.sprite)
  expect(await ui.find({ type: 'Text', text: /Unsaved changes/ })).toBeTruthy()
  // Cancel throws the draft away
  await ui.press({ key: 'crew-cancel' })
  expect(await ui.find({ type: 'Button', key: 'crew-save' })).toBeFalsy()

  // Change both, then Save applies them together; no character is ever doubled
  await ui.press({ key: `next-${first!.path}` })
  await ui.press({ key: `prev-${second!.path}` })
  await ui.press({ key: 'crew-save' })
  const after = crew()
  expect(after.find(c => c.path === first!.path)?.sprite).not.toBe(first!.sprite)
  expect(after.find(c => c.path === second!.path)?.sprite).not.toBe(second!.sprite)
  expect(new Set(after.map(c => c.sprite)).size).toBe(after.length)
  expect(await ui.find({ type: 'Button', key: 'crew-save' })).toBeFalsy()
  await ui.unmount()
})

test('a project that had Quark is moved to the Gorn', async ($, on) => {
  const store = engine(on)
  store.crewAssign = { '/Users/cap/MOD': 'quark' }
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  await ($.command.run as (input: { command: string; args: string }) => Promise<unknown>)({ command: 'crew', args: '' })
  expect((store.crew as { path: string; sprite: string }[]).find(c => c.path === '/Users/cap/MOD')?.sprite).toBe('gorn')
})

test('/hub clear says how the next hub gets made', async ($, on) => {
  const store = engine(on)
  store.hubUrl = 'https://claude.ai/artifact/hub1'
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  const ran = await ($.command.run as (input: { command: string; args: string }) => Promise<{ text?: string }>)({ command: 'hub', args: 'clear' })
  expect(ran.text).toContain('Close mission')
  expect(ran.text).not.toMatch(/next sync/)
})

test('console drawings fit a narrow pane, and a full deck of crew is never cut off', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  await ($.command.run as (input: { command: string; args: string }) => Promise<unknown>)({ command: 'crew', args: '' })
  const narrow = { ...pane('starfleet-console', 'desktop'), props: { ...pane('starfleet-console', 'desktop').props, bodyColumns: 24 } }
  const ui = await $.ui.mount(narrow)
  // Wide drawings carry no fixed size, so the surface scales them to the pane
  for (const svg of await ui.findAll({ type: 'Svg' })) {
    const w = (svg.props as { width?: number }).width
    if (w !== undefined) expect(w).toBeLessThanOrEqual(120)
  }
  // Narrow: the button grid goes to 2 columns, section codes hide, and codes never show a double dash
  const buttons = await ui.findAll({ type: 'Button' })
  expect(buttons.some(b => b.props.key === 'closure' || (b as { key?: string }).key === 'closure')).toBe(true)
  const tree = JSON.stringify(await $.ui.render(narrow))
  // Two columns, the first wider so "Captain mode: off" fits whole
  expect(tree).toContain('"58%"')
  expect(tree).toContain('"42%"')
  expect(tree).not.toMatch(/\d--\d/)
  // The viewscreen claims more width than any pane, so it fills its slot; its arrow has no hotkey
  const screen = (await ui.findAll({ type: 'Svg' })).find(x => String(x.props.alt).startsWith('Viewscreen'))
  expect(String(screen?.props.source)).toContain('width="1600"')
  expect(screen?.props.isInteractive).toBeUndefined()
  expect((await ui.find({ type: 'Button', key: 'planet-next' }))?.props.hotkey).toBeUndefined()
  await ui.unmount()
  const wide = JSON.stringify(await $.ui.render(pane('starfleet-console', 'desktop')))
  expect(wide).not.toMatch(/\d--\d/)
  const crew = Array.from({ length: 8 }, (_, i) => ({ path: `/p${i}`, project: `p${i}`, sprite: 'data', name: 'Data', status: '', deck: 'bridge' as const, isCurrent: false }))
  const viewBox = /viewBox="0 0 (\d+)/.exec(crewSvg(crew, 0))![1]!
  expect(Number(viewBox)).toBeGreaterThanOrEqual(14 + 8 * 66)
  // Every deck keeps full height and the width depends only on the crew size, so a sprite moving
  // anywhere (sickbay included) never changes the picture's shape: a picture that changes height
  // while Claude works makes the pane lose its scroll place
  const sizeOf = (svg: string) => /viewBox="0 0 (\d+) (\d+)"/.exec(svg)!.slice(1).map(Number)
  const shapeOf = (svg: string) => /viewBox="[^"]+" width="\d+" height="\d+"/.exec(svg)![0]
  const onBridge = crew.slice(0, 3)
  for (const deck of ['science', 'engineering', 'sickbay', 'quarters'] as const) {
    const moved = onBridge.map((c, i) => (i === 0 ? { ...c, deck } : c))
    expect(shapeOf(crewSvg(moved, 0))).toBe(shapeOf(crewSvg(onBridge, 0)))
  }
  const spread = onBridge.map((c, i) => ({ ...c, deck: (['bridge', 'sickbay', 'quarters'] as const)[i]! }))
  expect(shapeOf(crewSvg(spread, 0))).toBe(shapeOf(crewSvg(onBridge, 0)))
  const [w, h] = sizeOf(crewSvg(onBridge, 0))
  expect(w! / h!).toBeGreaterThan(1.2)
})

test('a crew member walks to a new deck once; later redraws draw it standing there', async () => {
  // Every redraw loads the picture afresh and restarts its animations, so a walk left in the
  // picture replays from the old deck on each redraw and the sprite never gets anywhere
  const walker = { path: '/walker', project: 'walker', sprite: 'walk-test', name: 'Data', status: '', deck: 'science' as const, isCurrent: false }
  crewSvg([walker], 1_000)
  const moved = { ...walker, deck: 'engineering' as const }
  expect(crewSvg([moved], 2_000)).toContain('@keyframes w0')
  expect(crewSvg([moved], 2_500)).toContain('@keyframes w0')
  expect(crewSvg([moved], 5_000)).not.toContain('@keyframes w0')
  expect(crewSvg([moved], 20_000)).not.toContain('@keyframes w0')
})

test('an acknowledged briefing stays gone after a reload or reopening the console', async ($, on) => {
  const store = engine(on)
  on('fs.read', () => ({ value: '# Handoff\nNext: wire the hub sync' }))
  on('model.complete', () => ({ value: { isAnswered: true, text: 'LEFT OFF: a\nSTANDING ORDER: b\nWATCH FOR: c', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }))
  on('audio.play', () => ({ value: undefined }))
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(pane('starfleet-console', 'desktop'))
  await ui.press({ key: 'brief' })
  await ui.press({ key: 'ack' })
  // Saved for this chat, so a reloaded mod (fresh memory) still reads it
  expect(store['briefing:sess-1']).toBe(true)
  await ($.command.run as (input: { command: string; args: string }) => Promise<unknown>)({ command: 'starfleet', args: '' })
  expect(await ui.find({ type: 'Button', key: 'brief' })).toBeFalsy()
  expect(await ui.find({ type: 'Text', text: /MISSION BRIEFING/ })).toBeFalsy()
  await ui.unmount()
})

test('every pane sits on the dark LCARS background with its own text colors, so light mode looks the same', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  await ($.command.run as (input: { command: string; args: string }) => Promise<unknown>)({ command: 'crew', args: '' })
  for (const id of ['starfleet-console', 'starfleet-crew', 'starfleet-log', 'starfleet-about', 'starfleet-core']) {
    const ui = await $.ui.mount(pane(id, 'desktop'))
    const boxes = await ui.findAll({ type: 'Box' })
    expect([id, (boxes[0]?.props as { backgroundColor?: string }).backgroundColor]).toEqual([id, '#07070c'])
    await ui.unmount()
  }
  // No text is left to follow the app's theme: top-level text gets the LCARS colors, dim text the dim
  // one, and text inside a colored Text keeps inheriting its color
  const painted = onDark({ type: 'Box', children: [
    { type: 'Text', children: ['plain'] },
    { type: 'Text', props: { dimColor: true }, children: ['quiet'] },
    { type: 'Text', props: { color: '#ffcc99' }, children: ['peach', { type: 'Text', children: ['inherits'] }] },
    { type: 'Text', props: { backgroundColor: '#ffcc99', color: '#000000' }, children: ['pill'] },
  ] }) as { props: { backgroundColor: string }; children: { children: { props?: Record<string, unknown>; children?: { props?: unknown }[] }[] }[] }
  expect(painted.props.backgroundColor).toBe('#07070c')
  const [plain, quiet, peach, pill] = painted.children[0]!.children
  expect(plain!.props).toEqual({ color: '#f1ece4' })
  expect(quiet!.props).toEqual({ color: '#8c8a96' })
  expect(peach!.children![1]!.props).toBeUndefined()
  expect(pill!.props).toEqual({ backgroundColor: '#ffcc99', color: '#000000' })

  // On the desktop a plain button turns secondary, not white; one that asked for primary keeps it
  const buttons = onDark({ type: 'Box', children: [
    { type: 'Button', props: { label: 'Focus', plain: true } },
    { type: 'Button', props: { label: 'Off', variant: 'secondary' } },
    { type: 'Button', props: { label: 'Picked', variant: 'primary' } },
  ] }, true) as { children: { children: { props: Record<string, unknown> }[] }[] }
  expect(buttons.children[0]!.children.map(b => b.props)).toEqual([
    { label: 'Focus', variant: 'secondary' },
    { label: 'Off', variant: 'secondary' },
    { label: 'Picked', variant: 'primary' },
  ])
})

test('every heading uses the one heading color, and the viewscreen keeps a roomy wide canvas', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  await ($.command.run as (input: { command: string; args: string }) => Promise<unknown>)({ command: 'crew', args: '' })
  for (const id of ['starfleet-crew', 'starfleet-log', 'starfleet-about', 'starfleet-core']) {
    const ui = await $.ui.mount(pane(id, 'desktop'))
    // Swatches and title pills (text on a background) all use peach; only warnings differ
    for (const t of await ui.findAll({ type: 'Text' })) {
      const bg = (t.props as { backgroundColor?: string }).backgroundColor
      if (bg && !/RED ALERT|ASSIMILATION|CONDITION /.test(t.text)) expect(bg).toBe('#ffcc99')
    }
    await ui.unmount()
  }
  // Section headings: bold name like the Captain's log, no number keys; briefing gets the swatch too
  const ui = await $.ui.mount(pane('starfleet-console', 'desktop'))
  for (const name of ['CREW DECKS', 'MAIN ENGINEERING', 'SERVICE RECORD', 'MISSION BRIEFING', 'CAPTAIN’S LOG']) {
    expect((await ui.find({ type: 'Text', text: name }))?.props.bold).toBe(true)
  }
  for (const id of ['crew', 'core', 'record']) expect((await ui.find({ type: 'Button', key: 'sec-' + id }))?.props.hotkey).toBeUndefined()
  // In the console each heading swatch matches its block's outline
  type Node = { type?: string; key?: string; props?: { key?: string; borderColor?: string; backgroundColor?: string; children?: unknown }; children?: unknown }
  const nodes = (n: unknown): Node[] => (n && typeof n === 'object' ? [n as Node, ...Object.values(n as object).flatMap(nodes)] : [])
  const tree = nodes(await $.ui.render(pane('starfleet-console', 'desktop')))
  for (const key of ['b-log', 'box-crew', 'box-core']) {
    const box = tree.find(n => (n.key ?? n.props?.key) === key && n.props?.borderColor)
    expect(box).toBeTruthy()
    const swatch = nodes(box).find(n => n !== box && n.props?.backgroundColor)
    expect(swatch?.props?.backgroundColor).toBe(box!.props!.borderColor)
  }
  const decks = (await ui.findAll({ type: 'Svg' })).find(x => String(x.props.source).includes('DECK 1'))
  expect(String(decks?.props.source)).toContain('width="1600"')
  await ui.unmount()
  const svg = viewscreenSvg('A very long project name here', 'none', undefined)
  expect(svg).toContain('viewBox="0 0 400 190"')
})

test('review: a held console keeps every picture the same between redraws with the orbit paused, and a free one carries the orbit on with the clock', async ($, on) => {
  // The desktop rebuilds a picture on each redraw, restarting its animations, so the orbit's start
  // comes from the clock. A pane that holds the keyboard is redrawn on every scroll tick, and a
  // source that changes per tick is reloaded (the shiver): so the clock is frozen when the pane
  // takes the keys and the orbit paused there. Swapping to a different picture on focus flickered
  // (repro panes, 2026-10-30)
  engine(on)
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  const p = pane('starfleet-console', 'desktop')
  const sources = async (isFocused: boolean) => {
    const ui = await $.ui.mount({ ...p, props: { ...p.props, isFocused } })
    const out = (await ui.findAll({ type: 'Svg' })).map(s => String(s.props.source))
    await ui.unmount()
    return out
  }
  const orbit = (pics: string[]) => pics.find(svg => svg.includes('STANDARD ORBIT'))?.match(/\.ship\{[^}]*\}/)?.[0]
  const delay = (rule?: string) => Number(rule?.match(/animation-delay:(-?[\d.]+)s/)?.[1])
  try {
    // Free: 7 seconds on, the orbit starts 7 seconds further along, and nothing is paused
    pinnedNow = new Date(2026, 9, 28, 10, 54, 0).getTime()
    const start = await sources(false)
    pinnedNow = new Date(2026, 9, 28, 10, 54, 7).getTime()
    const later = await sources(false)
    expect(start.length).toBeGreaterThan(1)
    expect(Math.round((delay(orbit(start)) - delay(orbit(later))) * 1000)).toBe(7000)
    expect(start.some(svg => svg.includes('animation-play-state:paused'))).toBe(false)
    // Held: a day and 7 seconds apart, every picture is the same source, with the orbit paused
    // where the clock stood when the pane took the keys
    pinnedNow = new Date(2026, 9, 28, 10, 54, 7).getTime()
    const held = await sources(true)
    pinnedNow = new Date(2026, 9, 29, 10, 54, 14).getTime()
    const stillHeld = await sources(true)
    expect(stillHeld).toEqual(held)
    expect(orbit(held)).toContain('animation:orbit')
    expect(held.some(svg => svg.includes('.ship,.glow,.spark{animation-play-state:paused}'))).toBe(true)
    expect(delay(orbit(held))).toBe(delay(orbit(later)))
    // Let go, the clock runs again
    expect((await sources(false)).some(svg => svg.includes('animation-play-state:paused'))).toBe(false)
  } finally {
    pinnedNow = undefined
  }
})

test('the service record only counts up: a stale or unloaded copy never writes lower numbers', async ($, on) => {
  const store = engine(on)
  store.record = { sessions: 3, turns: 5, blocked: 0, scans: 0 }
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  // Another chat has counted far past this one's copy in the meantime
  store.record = { sessions: 18, turns: 191, blocked: 2, scans: 0 }
  await callTool($, { tool: 'mcp__starfleet__sensor_scan', target: 'the nebula' })
  expect(store.record).toEqual({ sessions: 18, turns: 191, blocked: 2, scans: 1 })
})

// ── UI function review: these three run after every UI change (the ui-function-review skill; what tests can't see is in tests/LIVE-CHECKLIST.md) ──

const ALL_PANES = ['starfleet-console', 'starfleet-crew', 'starfleet-log', 'starfleet-about', 'starfleet-core', 'starfleet-record', 'starfleet-ship', 'starfleet-bridge', 'starfleet-translator']

test('review: what a chat remembers comes back after a reload', async ($, on) => {
  const toasts: string[] = []
  const store = engine(on, undefined, undefined, { toasts })
  // What an earlier load of the mod in this chat left behind
  store['coreAlert:sess-1'] = { tier: 2, isMemoryAlertRaised: false }
  store['logDraft:sess-1'] = 'half a thought'
  store['briefing:sess-1'] = true
  store.record = { sessions: 18, turns: 191, blocked: 0, scans: 0 }
  store.consoleOpen = { crew: false, core: true, record: true }
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(pane('starfleet-console', 'desktop'))
  // Context is still at 75%: the tier was already announced, so no repeat toast
  expect(toasts.some(t => /Assimilation|Borg/.test(t))).toBe(false)
  const logTab = await $.ui.mount(pane('starfleet-log', 'desktop'))
  expect((await logTab.find({ type: 'Input', key: 'log-0' }))?.props.value).toBe('half a thought')
  await logTab.unmount()
  expect(await ui.find({ type: 'Button', key: 'brief' })).toBeFalsy()
  expect(await ui.find({ type: 'Text', text: /191 prompts/ })).toBeTruthy()
  expect((await ui.find({ type: 'Button', key: 'sec-crew' }))?.text).toBe('▸')
  await ui.unmount()
})

test('review: every button in every pane presses without an error, on desktop and terminal', async ($, on) => {
  engine(on)
  on('tool.call', () => ({ result: 'ok' }))
  on('prompt.submit', (_: unknown, e: { text: string }) => ({ text: e.text }))
  on('prompt.fill', () => ({ isFilled: true }))
  on('audio.play', () => ({ value: undefined }))
  on('session.compact', () => ({ skip: 'not in a test' }))
  on('model.complete', () => ({ value: { isAnswered: true, text: 'LEFT OFF: a\nSTANDING ORDER: b\nWATCH FOR: c', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }))
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  await ($.command.run as (input: { command: string; args: string }) => Promise<unknown>)({ command: 'crew', args: '' })
  const pressed: string[] = []
  for (const surface of ['desktop', 'terminal'] as const) {
    for (const id of ALL_PANES) {
      const ui = await $.ui.mount(pane(id, surface))
      const keys = (await ui.findAll({ type: 'Button' })).map(b => (b as { key?: string }).key ?? b.props.key).filter(Boolean) as string[]
      for (const key of keys) {
        // A press can redraw the pane (Focus hides the rest): press only what is still drawn
        if (!(await ui.find({ type: 'Button', key }))) continue
        await ui.press({ key })
        pressed.push(`${surface}:${id}:${key}`)
      }
      await ui.unmount()
      // Focus mode hides the console's buttons; come back for the next pane
      await ($.command.run as (input: { command: string; args: string }) => Promise<unknown>)({ command: 'starfleet', args: '' })
    }
  }
  expect(pressed.length).toBeGreaterThan(20)
})

test('review: every pane draws at narrow, medium and wide widths without fixed-size pictures', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  await ($.command.run as (input: { command: string; args: string }) => Promise<unknown>)({ command: 'crew', args: '' })
  for (const surface of ['desktop', 'terminal'] as const) {
    for (const id of ALL_PANES) {
      for (const bodyColumns of [24, 50, 120]) {
        const p = pane(id, surface)
        const ui = await $.ui.mount({ ...p, props: { ...p.props, bodyColumns } })
        // Small fixed art (the core, rank pips) may keep its size; anything wider must scale to the pane
        for (const svg of await ui.findAll({ type: 'Svg' })) {
          const w = (svg.props as { width?: number }).width
          if (w !== undefined) expect(w).toBeLessThanOrEqual(160)
        }
        await ui.unmount()
      }
    }
  }
})

test('review: lines that change while Claude works are one line each, and nothing appears mid-turn', async ($, on) => {
  engine(on)
  on('prompt.submit', (_: unknown, e: { text: string }) => ({ text: e.text }))
  on('model.complete', () => new Promise(() => {}))
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  const narrow = { ...pane('starfleet-console', 'desktop'), props: { ...pane('starfleet-console', 'desktop').props, bodyColumns: 30 } }
  const ui = await $.ui.mount(narrow)
  // A long prompt waits for its summary: no extra 'Summarizing' line comes and goes
  await $.prompt.submit({ text: 'please look into why the console scroll position jumps around while you are working' } as never)
  expect(await ui.find({ type: 'Text', text: /Summarizing/ })).toBeFalsy()
  // The time log and tools-used lines, and main engineering's values (under their labels): core load,
  // dilithium, warp drive
  for (const line of [/TIME LOG/, /TOOLS USED/, /^\d+%/, /tokens|Reading/, /^Standing by|^Engaged/]) {
    const text = (await ui.findAll({ type: 'Text' })).find(t => line.test(t.text) && (t.props as { wrap?: string }).wrap)
    expect((text?.props as { wrap?: string } | undefined)?.wrap).toBe('truncate')
  }
  expect(await ui.find({ type: 'Text', text: /this mission/ })).toBeFalsy()
  await ui.unmount()
})

test('a stardate is month and day, then the year', () => {
  expect(stardate(new Date(2026, 9, 27, 10, 54).getTime())).toBe('1027.26')
  expect(stardate(new Date(2030, 0, 5).getTime())).toBe('0105.30')
})

test('only a test or build command counts as diagnostics', async () => {
  for (const ran of ['npm test', 'cd app && pnpm run build', 'pytest -q', 'tsc -p .', 'make', 'claude plugin test .']) expect(TEST_OR_BUILD.test(ran)).toBe(true)
  for (const other of ['grep -rn make src', 'git commit -m "fix tsc"', 'echo pytest', 'cat Makefile']) expect(TEST_OR_BUILD.test(other)).toBe(false)
})

test('a crew member keeps its sprite for good; only newcomers avoid a neighbor\'s shirt color', async ($, on) => {
  const store = engine(on)
  // Both wear yellow and stand side by side: neither is switched
  store.crewAssign = { '/Users/cap/MOD': 'data', '/Users/cap/old/app': 'geordi' }
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  const run = $.command.run as (input: { command: string; args: string }) => Promise<unknown>
  await run({ command: 'crew', args: '' })
  expect((store.crew as { sprite: string }[]).map(c => c.sprite)).toEqual(['data', 'geordi'])
  // A newcomer next to a yellow shirt picks another color
  store.crewAssign = { '/Users/cap/MOD': 'data' }
  await run({ command: 'crew', args: '' })
  const shirt: Record<string, string> = { picard: 'r', riker: 'r', data: 'y', geordi: 'y', worf: 'y', seven: 'g', troi: 'p', crusher: 't' }
  const crew = store.crew as { sprite: string }[]
  expect(crew[0]!.sprite).toBe('data')
  expect(shirt[crew[1]!.sprite]).not.toBe('y')
})

test('a deck another chat posts moves that project on every console', async ($, on) => {
  // The mock file system decodes that project folder as /Users/cap/old/app
  const post = JSON.stringify({ path: '/Users/cap/old/app', deck: 'engineering', at: Date.now() })
  engine(on, undefined, { name: '-Users-cap-old-app.json', text: post })
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'terminal', isInteractive: true })
  await ($.command.run as (input: { command: string; args: string }) => Promise<unknown>)({ command: 'crew', args: '' })
  // Nine days idle would put it in quarters; the live post puts it in engineering
  expect(await deckOn($, 'app')).toBe('engineering')
})

test('each captain gets their own hub: the first sync publishes it, then syncs go there', async ($, on) => {
  const store = engine(on)
  on('audio.play', () => ({ value: undefined }))
  const sent: string[] = []
  on('prompt.submit', (_: unknown, e: { text: string }) => { sent.push(e.text); return { text: e.text } })
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  const run = $.command.run as (input: { command: string; args: string }) => Promise<{ text?: string }>

  // No hub yet: the closure report publishes one from the bundled template first, and names no one else's hub
  expect((await run({ command: 'hub', args: '' })).text).toContain('No hub yet')
  const ui = await $.ui.mount(pane('starfleet-console', 'desktop'))
  await ui.press({ key: 'closure' })
  await new Promise(done => setTimeout(done, 20))
  const first = sent.find(t => t.includes('CLOSURE REPORT'))!
  expect(first).toContain('assets/hub.html')
  expect(first).toContain('starfleet_set_hub')
  expect(first).not.toMatch(/claude\.ai\/artifact/)

  // Claude saves the new hub; anything but an artifact link is refused
  const setHub = (url: string) => callTool($, { tool: 'mcp__starfleet__starfleet_set_hub', url }) as Promise<{ result: string }>
  expect((await setHub('https://evil.example/x')).result).toContain('Not saved')
  expect(store.hubUrl).toBeUndefined()
  expect((await setHub('https://claude.ai/artifact/MyOwnHub123')).result).toContain('Hub saved')

  // Later syncs go to that hub, and the records name it
  sent.length = 0
  await ui.press({ key: 'closure' })
  await new Promise(done => setTimeout(done, 20))
  const second = sent.find(t => t.includes('CLOSURE REPORT'))!
  expect(second).toContain('https://claude.ai/artifact/MyOwnHub123')
  expect(second).not.toContain('assets/hub.html')
  const records = JSON.parse(String((await callTool($, { tool: 'mcp__starfleet__starfleet_records' }) as { result: unknown }).result))
  expect(records.hubUrl).toBe('https://claude.ai/artifact/MyOwnHub123')
  await ui.unmount()

  // /hub sets, shows and forgets it
  expect((await run({ command: 'hub', args: 'not a link' })).text).toContain('not a claude.ai artifact link')
  expect((await run({ command: 'hub', args: 'https://claude.ai/code/artifact/abc-123' })).text).toContain('hub set')
  expect((await run({ command: 'hub', args: '' })).text).toContain('abc-123')
  await run({ command: 'hub', args: 'clear' })
  expect(store.hubUrl).toBeUndefined()
})

test('an old session gives its log to the archive, and its other keys are cleared', async ($, on) => {
  const store = engine(on)
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  const run = $.command.run as (input: { command: string; args: string }) => Promise<unknown>
  await run({ command: 'log', args: 'note from the first session' })
  store['lastPrompt:sess-1'] = { text: 'x'.repeat(100), at: 1 }
  store['lastPrompt:ghost'] = { text: 'from before tracking', at: 1 }
  // 20 more sessions push sess-1 out of the kept window
  for (let i = 0; i < 20; i++) {
    sessionId = `later-${i}`
    await run({ command: 'log', args: `note ${i}` })
  }
  sessionId = 'sess-1'
  expect((store.logSessions as string[]).length).toBe(20)
  expect(store['log:sess-1']).toBeUndefined()
  expect(store['lastPrompt:sess-1']).toBeUndefined()
  expect(store['lastPrompt:ghost']).toBeUndefined()
  // The note is not lost: it sits in the archive, once
  const archive = store.logArchive as { text: string }[]
  expect(archive.filter(e => e.text === 'note from the first session').length).toBe(1)
})

test('make it so approves only the proposed step, in words the captain can see', async ($, on) => {
  engine(on)
  on('audio.play', () => ({ value: undefined }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  const sent: { text: string; context?: readonly string[] }[] = []
  on('prompt.submit', (_: unknown, e: { text: string; context?: readonly string[] }) => { sent.push(e); return { text: e.text } })
  const suggested: string[] = []
  on('prompt.suggest', (_: unknown, e: { text: string }) => { suggested.push(e.text); return { isShown: true } })
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })

  await ($.prompt.submit as (e: { text: string }) => Promise<unknown>)({ text: 'Make it so!' })
  const order = sent.at(-1)!
  expect(order.text).toContain('Make it so: Go ahead with the one step you just proposed, and only that step.')
  expect(order.text).toContain('Ask me first before anything destructive')
  expect(order.context ?? []).toEqual([])

  // A plain question gets the one-key suggestion; a risky one does not
  const complete = $.turn.complete as (e: unknown) => Promise<unknown>
  await complete({ durationMs: 1000, answer: 'The tests pass. Shall I add the README section?', isAborted: false })
  await new Promise(done => setTimeout(done, 20))
  expect(suggested).toEqual(['make it so'])
  await complete({ durationMs: 1000, answer: 'Shall I delete the old branches and force-push?', isAborted: false })
  await new Promise(done => setTimeout(done, 20))
  expect(suggested).toEqual(['make it so'])
})

test('with AI summaries off, nothing is sent to a model for titles or briefings', async ($, on) => {
  const store = engine(on)
  const asked: string[] = []
  on('model.complete', (_: unknown, e: { prompt: string }) => { asked.push(e.prompt); return { value: { isAnswered: true, text: 'Fix the crash', usage: { input_tokens: 1, output_tokens: 1 } } as never } })
  on('prompt.submit', (_: unknown, e: { text: string }) => ({ text: e.text }))
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  const run = $.command.run as (input: { command: string; args: string }) => Promise<{ text?: string }>
  expect((await run({ command: 'ai-summaries', args: '' })).text).toContain('AI summaries on')
  expect((await run({ command: 'ai-summaries', args: 'off' })).text).toContain('AI summaries off')
  expect(store.aiSummaries).toBe(false)

  const long = 'Please look into why the warp core crashes on startup when the config file is missing'
  await ($.prompt.submit as (e: { text: string }) => Promise<unknown>)({ text: long })
  await run({ command: 'log', args: 'remember the dilithium' })
  const ui = await $.ui.mount(pane('starfleet-console', 'desktop'))
  await ui.press({ key: 'brief' })
  await new Promise(done => setTimeout(done, 20))
  await ui.unmount()
  expect(asked).toEqual([])
  // The title comes from the prompt's own first line instead
  expect((store['lastPrompt:' + sessionId] as { summary?: string }).summary).toContain('Please look into why the warp core')
})

test('eject asks for a handoff that replaces the last one and drops nothing', async ($, on) => {
  engine(on)
  on('audio.play', () => ({ value: undefined }))
  on('clock.after', () => ({ value: undefined }))
  const sent: string[] = []
  on('prompt.submit', (_: unknown, e: { text: string }) => { sent.push(e.text); return { text: e.text } })
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  // The first press arms the core; the second ejects it
  const core = await $.ui.mount(pane('starfleet-core', 'desktop'))
  await core.press({ key: 'eject' })
  await core.press({ key: 'eject' })
  await new Promise(done => setTimeout(done, 20))
  const ask = sent.find(t => t.includes('handoff document'))!
  expect(ask).toContain('Replaces:')
  expect(ask).toContain('Never edit it or any other earlier handoff')
  expect(ask).toContain('Nothing is dropped silently')
  expect(ask).toContain('Each item goes in exactly one section')
  expect(ask).toContain('To try')
  for (const section of ['Goal', 'Gotchas', 'How to verify']) expect(ask).toContain(section)
  expect(ask).toContain('go into memory or CLAUDE.md, not the handoff')
  await core.unmount()
})

test('from 70% the core asks once per tier whether the work is mid-task, and recommends compact or eject', async ($, on) => {
  const store = engine(on)
  on('audio.play', () => ({ value: undefined }))
  on('session.measure', () => ({ changed: [] }))
  on('session.compact', () => ({ skip: 'not in a test' }))
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  const measure = $.session.measure as unknown as (input: object) => Promise<unknown>
  const context = (percent: number) => ({ context: { tokens: percent * 2000, window: 200000, percent } })

  // 75%: the band asks, and offers no move until answered
  let ui = await $.ui.mount(band('desktop', false))
  expect(await ui.find({ type: 'Text', text: /Still mid-task/ })).toBeTruthy()
  expect(await ui.find({ type: 'Button', key: 'band-compact' })).toBeFalsy()
  await ui.press({ key: 'band-mid' })
  expect(await ui.find({ type: 'Text', text: /Still mid-task/ })).toBeFalsy()
  expect(await ui.find({ type: 'Button', key: 'band-compact' })).toBeTruthy()
  expect(await ui.find({ type: 'Button', key: 'band-eject' })).toBeFalsy()
  expect((store['coreAlert:sess-1'] as { advice?: unknown }).advice).toEqual({ tier: 2, answer: 'mid' })
  await ui.unmount()

  // The warp core pane shows the same recommendation
  const core = await $.ui.mount(pane('starfleet-core', 'desktop'))
  expect(await core.find({ type: 'Text', text: /Recommended: Compact/ })).toBeTruthy()
  expect(await core.find({ type: 'Button', key: 'mid' })).toBeFalsy()
  await core.unmount()

  // 87%: a new tier asks again; done recommends eject
  await measure(context(87))
  ui = await $.ui.mount(band('desktop', false))
  expect(await ui.find({ type: 'Text', text: /Still mid-task/ })).toBeTruthy()
  await ui.press({ key: 'band-done' })
  expect(await ui.find({ type: 'Button', key: 'band-eject' })).toBeTruthy()
  expect(await ui.find({ type: 'Button', key: 'band-compact' })).toBeFalsy()
  await ui.unmount()
})

test('an answered mid-task question stays answered after a reload', async ($, on) => {
  const store = engine(on)
  store['coreAlert:sess-1'] = { tier: 2, isMemoryAlertRaised: false, advice: { tier: 2, answer: 'done' } }
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(band('terminal', false))
  expect(await ui.find({ type: 'Text', text: /Still mid-task/ })).toBeFalsy()
  expect(await ui.find({ type: 'Button', key: 'band-eject' })).toBeTruthy()
  await ui.unmount()
})

test('dilithium shows the window Claude Code reports, not one worked out from a rounded percent', async ($, on) => {
  engine(on)
  on('session.measure', () => ({ changed: [] }))
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  const measure = $.session.measure as unknown as (input: object) => Promise<unknown>
  // 150.5k of a 1M window rounds to 15%, which would read as 1003k
  await measure({ context: { tokens: 150500, window: 1000000, percent: 15 } })
  const ui = await $.ui.mount(pane('starfleet-console', 'desktop'))
  expect(await ui.find({ type: 'Text', text: /151k of 1000k tokens/ })).toBeTruthy()
  await ui.unmount()
})

test('the captain\'s log is gold and the crew decks grey, and the readout labels are bold', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(pane('starfleet-console', 'desktop'))
  expect((await ui.find({ type: 'Box', key: 'b-log' }))?.props.borderColor).toBe('#ffcc33')
  expect((await ui.find({ type: 'Box', key: 'box-crew' }))?.props.borderColor).toBe('#8c8a96')
  // No other block borrows the log's gold or the crew's grey
  for (const key of ['b-view', 'b-status', 'box-core', 'box-record']) {
    expect(['#ffcc33', '#8c8a96']).not.toContain((await ui.find({ type: 'Box', key }))?.props.borderColor)
  }
  // The service record starts folded; open it to see its readouts
  if (!(await ui.find({ type: 'Text', text: /PROMPTS/ }))) await ui.press({ key: 'sec-record' })
  const texts = await ui.findAll({ type: 'Text' })
  for (const label of ['COURSE', 'TIME LOG', 'TOOLS USED', 'CORE LOAD', 'DILITHIUM', 'CONDITION', 'WARP DRIVE', 'PROMPTS', 'TOURS', 'DEFLECTED', 'SCANS']) {
    const t = texts.find(x => x.text.trim() === label)
    expect(t ? `${label}:${(t.props as { bold?: boolean }).bold}` : `${label}:missing`).toBe(`${label}:true`)
  }
  expect(await ui.find({ type: 'Text', text: /^ CONDITION (GREEN|YELLOW|BORG|RED) $/ })).toBeTruthy()
  await ui.unmount()
})

test('the log field lives in its own tab, so typing never gives the console the keys', async ($, on) => {
  const store = engine(on)
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  // No field in the console at any width: a focused field there makes the pane shiver on scroll
  for (const bodyColumns of [24, 50, 120]) {
    const p = pane('starfleet-console', 'desktop')
    const ui = await $.ui.mount({ ...p, props: { ...p.props, bodyColumns } })
    expect(await ui.find({ type: 'Input' })).toBeFalsy()
    expect(await ui.find({ type: 'Text', text: /\/log and a note/ })).toBeTruthy()
    await ui.unmount()
  }
  // The console's button opens the tab, focused on its field
  const ui = await $.ui.mount(pane('starfleet-console', 'desktop'))
  await ui.press({ key: 'open-log' })
  expect(opened).toContain('starfleet-log')
  await ui.unmount()
  // A draft typed there is kept until it is recorded, then cleared
  const tab = await $.ui.mount(pane('starfleet-log', 'desktop'))
  expect((await tab.find({ type: 'Input', key: 'log-0' }))?.props.autoFocus).toBe(true)
  store['logDraft:sess-1'] = 'half a log'
  await $.ui.input({ plugin: 'starfleet', key: 'log-0', text: 'half a log, finished' })
  expect(JSON.stringify(store['log:sess-1'])).toContain('half a log, finished')
  expect(store['logDraft:sess-1']).toBeUndefined()
  expect((await tab.find({ type: 'Input', key: 'log-1' }))?.props.value).toBe('')
  await tab.unmount()
})

test('the course line says in plain words when the last check passed or failed', () => {
  const base = { startedAt: 0, warpMs: 0, orders: 0, files: ['a.ts'], scans: 0, greenBuilds: 3, commits: 0 }
  const now = 10 * 60000
  expect(courseOf({ ...base, lastBuild: 'pass', lastBuildAt: now - 4 * 60000 }, now).detail).toBe('1 file changed · tests passed 3 times · last check passed 4m ago')
  const breach = courseOf({ ...base, lastBuild: 'fail', lastBuildAt: now - 30000 }, now)
  expect(breach.label).toBe('HULL BREACH')
  expect(breach.detail).toBe('last check failed just now · 1 file changed · tests passed 3 times')
  // A voyage saved before checks had a time still reads
  expect(courseOf({ ...base, lastBuild: 'pass', lastBuildAt: null }, now).detail).toContain('last check passed')
})

test('the cast hands out every square first, then the picture tags, with Riker last as the backup', () => {
  const squares = ['🟥', '🟧', '🟨', '🟩', '🟦', '🟪', '🟫', '⬛', '⬜']
  expect(SPRITE_ORDER).toHaveLength(15)
  for (const key of SPRITE_ORDER.slice(0, 9)) expect(squares).toContain(SPRITES[key]!.emoji)
  expect(SPRITE_ORDER.slice(9).map(k => SPRITES[k]!.emoji)).toEqual(['⚡', '🩷', '🧶', '🐈', '🍺', '🔴'])
  expect(SPRITE_ORDER.at(-1)).toBe('riker')
  expect(SPRITES.gorn!.emoji).toBe('🟩')
  expect(SPRITES.quark).toBeUndefined()
  // Every tag is its own, so a chat and its crew member always match
  expect(new Set(SPRITE_ORDER.map(k => SPRITES[k]!.emoji)).size).toBe(SPRITE_ORDER.length)
  for (const key of SPRITE_ORDER) expect(SPRITE_COLORS[key]).toMatch(/^#[0-9a-f]{6}$/)
  for (const key of SPRITE_ORDER) expect(taggedTitle(`${SPRITES[key]!.emoji} Old chat`, '🟥')).toBe('🟥 Old chat')
})

test('the default planet is drawn in the project\'s crew color; a picked planet keeps its own', () => {
  const troi = SPRITE_COLORS.troi!
  expect(viewscreenSvg('MOD', 'none', undefined, troi)).toContain(troi)
  expect(viewscreenSvg('MOD', 'none', 'classm', troi)).not.toContain(troi)
})

test('an ale tag, or the heart Guinan had before it, is swapped like any other crew tag', () => {
  expect(taggedTitle('🍺 Old chat', '🟩')).toBe('🟩 Old chat')
  expect(taggedTitle('🩷 Old chat', '🍺')).toBe('🍺 Old chat')
})

test('after /clear the new chat gets its own warp core question and an empty log draft', async ($, on) => {
  const store = engine(on)
  on('session.measure', () => ({ changed: [] }))
  store['logDraft:sess-1'] = 'old chat draft'
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  let ui = await $.ui.mount(band('desktop', false))
  await ui.press({ key: 'band-done' })
  await ui.unmount()
  // /clear: same process, new chat id
  sessionId = 'sess-clear'
  try {
    await ($.session.measure as unknown as (input: object) => Promise<unknown>)({ context: { tokens: 150000, window: 200000, percent: 75 } })
    ui = await $.ui.mount(band('desktop', false))
    expect(await ui.find({ type: 'Text', text: /Still mid-task/ })).toBeTruthy()
    await ui.unmount()
    const logTab = await $.ui.mount(pane('starfleet-log', 'desktop'))
    const field = (await logTab.findAll({ type: 'Input' })).find(i => String((i as { key?: string }).key ?? i.props.key).startsWith('log-'))
    expect(field?.props.value).toBe('')
    await logTab.unmount()
  } finally {
    sessionId = 'sess-1'
  }
})

test('once a compact drops the load, climbing back past 70% asks again', async ($, on) => {
  engine(on)
  on('session.measure', () => ({ changed: [] }))
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  const measure = $.session.measure as unknown as (input: object) => Promise<unknown>
  const context = (percent: number) => ({ context: { tokens: percent * 2000, window: 200000, percent } })
  let ui = await $.ui.mount(band('desktop', false))
  await ui.press({ key: 'band-mid' })
  await ui.unmount()
  await measure(context(20))
  await measure(context(74))
  ui = await $.ui.mount(band('desktop', false))
  expect(await ui.find({ type: 'Text', text: /Still mid-task/ })).toBeTruthy()
  await ui.unmount()
})

test('condition Borg is orange, never the all-clear green', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(pane('starfleet-console', 'desktop'))
  const badge = await ui.find({ type: 'Text', text: /^ CONDITION BORG $/ })
  expect(badge?.props.backgroundColor).toBe('#ff9966')
  await ui.unmount()
})

test('a worktree chat counts as its project\'s crew member, so the planet takes the crew color', async ($, on) => {
  const store = engine(on, undefined, undefined, { cwd: '/Users/cap/MOD/.claude/worktrees/fix-1' })
  await $.session.start({ cwd: '/Users/cap/MOD/.claude/worktrees/fix-1', surface: 'desktop', isInteractive: true })
  await ($.command.run as (input: { command: string; args: string }) => Promise<unknown>)({ command: 'crew', args: '' })
  const mod = (store.crew as { path: string; sprite: string }[]).find(c => c.path === '/Users/cap/MOD')!
  const ui = await $.ui.mount(pane('starfleet-console', 'desktop'))
  const screen = (await ui.findAll({ type: 'Svg' })).find(s => String(s.props.alt ?? '').startsWith('Viewscreen'))
  expect(String(screen?.props.source)).toContain(SPRITE_COLORS[mod.sprite]!)
  await ui.unmount()
})

test('the hub keeps no crew roster: Rescan touches nothing there, and each mission carries its crew member', async ($, on) => {
  const store = engine(on)
  const sent: string[] = []
  on('prompt.submit', (_: unknown, e: { text: string }) => { sent.push(e.text); return { text: e.text } })
  store.hubUrl = 'https://claude.ai/artifact/hub1'
  // This chat's mission, in its MOD project
  store['missions:sess-1'] = [{ id: 'sess-1', stardate: '1028.26', at: Date.now(), project: 'MOD', cwd: '/Users/cap/MOD', turns: 3, redAlerts: 0, handoffs: 0 }]
  const hub: unknown[] = []
  on('tool.call', (_: unknown, e: { tool: string }) => {
    if (e.tool === 'ArtifactData') hub.push(e)
    return { result: 'ok', text: 'committed' }
  })
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(pane('starfleet-crew', 'desktop'))
  expect((await ui.find({ type: 'Button', key: 'rescan' }))?.props.label).toBe('Rescan crew')
  await ui.press({ key: 'rescan' })
  await new Promise(done => setTimeout(done, 20))
  await ui.unmount()
  expect(hub).toEqual([])
  expect(sent).toEqual([])
  // The sync no longer writes a crew collection, and every mission names its crew member
  const records = JSON.parse((await callTool($, { tool: 'mcp__starfleet__starfleet_records' }) as { result: string }).result) as { missions: { sprite?: string; tag?: string; crewName?: string }[] }
  const mod = (store.crew as { path: string; sprite: string }[]).find(c => c.path === '/Users/cap/MOD')!
  expect(records.missions[0]).toMatchObject({ sprite: mod.sprite, tag: SPRITES[mod.sprite]!.emoji, crewName: SPRITES[mod.sprite]!.name })
})

test('a hotkey does the same thing in every pane, and no label repeats its key in brackets', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  await ($.command.run as (input: { command: string; args: string }) => Promise<unknown>)({ command: 'crew', args: '' })
  const byKey = new Map<string, Set<string>>()
  for (const id of ALL_PANES) {
    const ui = await $.ui.mount(pane(id, 'desktop'))
    for (const b of await ui.findAll({ type: 'Button' })) {
      const label = String(b.props.label ?? '')
      // The engine adds the hotkey to a label itself ("Captain mode: off (c)"); a label never adds it twice
      expect(label).not.toMatch(/\([a-z0-9]\) \([a-z0-9]\)$/)
      const hotkey = b.props.hotkey as string | undefined
      if (hotkey) byKey.set(hotkey, new Set([...(byKey.get(hotkey) ?? []), `${id}:${label.replace(/^\W+\s*/, '').split(/[:·]/)[0]!.trim()}`]))
    }
    await ui.unmount()
  }
  // Compact memory, Mid-task and Rescan each have one key wherever they show
  const labelsOf = (key: string) => [...(byKey.get(key) ?? [])].map(s => s.split(':')[1])
  for (const label of labelsOf('m')) expect(label).toBe('Compact memory')
  for (const label of labelsOf('n')) expect(label).toMatch(/^Rescan/)
  expect(labelsOf('t')).toEqual(['Mid-task'])
})

test('another mod holding /ai-summaries or /hub never stops /starfleet from registering', async ($, on) => {
  const registered: string[] = []
  engine(on, undefined, undefined, { register: (_: unknown, e: { name: string }) => {
    if (e.name === 'ai-summaries' || e.name === 'hub') throw new Error(`/${e.name} is taken by baseplate`)
    registered.push(e.name)
    return { value: { command: e.name } }
  } })
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  for (const name of ['starfleet', 'log', 'crew', 'warp-core', 'bridge']) expect(registered).toContain(name)
})

test('a newer Starfleet on GitHub gets one toast a day that says how to update, and the same version none', async ($, on) => {
  const toasts: string[] = []
  const store = engine(on, undefined, undefined, { toasts })
  let remote = '0.4.20'
  const fetched: string[] = []
  on('fs.read', (_: unknown, e: { path: string }) => ({ value: e.path.endsWith('plugin.json') ? '{"version":"0.4.14"}' : '' }))
  on('http.fetch', (_: unknown, e: { url: string }) => { fetched.push(e.url); return { value: { status: 200, ok: true, headers: {}, text: `{"version":"${remote}"}` } } })
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  await new Promise(done => setTimeout(done, 20))
  expect(fetched).toEqual(['https://raw.githubusercontent.com/lorlola07/starfleet/main/.claude-plugin/plugin.json'])
  expect(toasts.some(t => t.includes('0.4.20 is out') && t.includes('/plugin update starfleet'))).toBe(true)
  // Checked today already: no second request
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  await new Promise(done => setTimeout(done, 20))
  expect(fetched.length).toBe(1)
  // A day on, the same version as installed: a request but no toast
  store.updateCheckedAt = 0
  remote = '0.4.14'
  const before = toasts.length
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  await new Promise(done => setTimeout(done, 20))
  expect(fetched.length).toBe(2)
  expect(toasts.slice(before).some(t => t.includes('is out'))).toBe(false)
  expect([isNewer('0.4.14', '0.4.9'), isNewer('0.4.9', '0.4.14'), isNewer('0.5', '0.4.99'), isNewer('0.4.14', '0.4.14')]).toEqual([true, false, true, false])
})

test('About gives every part its name in the heading color', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(pane('starfleet-about', 'desktop'))
  for (const name of ['Viewscreen', 'Shields', 'Starfleet Command hub']) {
    const t = (await ui.findAll({ type: 'Text' })).find(x => x.text === name && (x.props as { bold?: boolean }).bold)
    expect([name, (t?.props as { color?: string })?.color]).toEqual([name, '#ffcc99'])
  }
  await ui.unmount()
})

test('the project map files a folder under a project, in the records, the briefing and on removal', async ($, on) => {
  const store = engine(on, undefined, undefined, { cwd: '/Users/cap/harbor' })
  store['log:sess-1'] = [{ id: 'log-a', stardate: '1030.26', text: 'home note', at: Date.now(), project: 'harbor', category: 'note' }]
  store['missions:sess-1'] = [{ id: 'sess-1', stardate: '1030.26', at: Date.now(), project: 'harbor', cwd: '/Users/cap/harbor/.claude/worktrees/x', turns: 0, redAlerts: 0, handoffs: 0 }]
  store.logSessions = ['sess-1']
  await $.session.start({ cwd: '/Users/cap/harbor', surface: 'desktop', isInteractive: true })
  const map = (input: object) => callTool($, { tool: 'mcp__starfleet__starfleet_project_map', ...input }) as Promise<{ result: string }>
  expect((await map({})).result).toContain('empty')
  // A full path or any case files under the folder's own name
  expect((await map({ folder: '/Users/cap/Harbor', project: 'Project Harbor' })).result).toContain('harbor now files under Project Harbor')
  const records = JSON.parse((await callTool($, { tool: 'mcp__starfleet__starfleet_records' }) as { result: string }).result)
  expect(records.log[0].project).toBe('Project Harbor')
  // A worktree mission counts for the folder it was cut from
  expect(records.missions[0].project).toBe('Project Harbor')
  // The briefing reads this chat's project through the map, so it finds notes from the project's other folders
  store['log:sess-0'] = [{ id: 'log-b', stardate: '1029.26', text: 'dock note', at: Date.now() - 1000, project: 'Dock', category: 'note' }]
  store.logSessions = ['sess-1', 'sess-0']
  store.aiSummaries = false
  await map({ folder: 'Dock', project: 'Project Harbor' })
  const ui = await $.ui.mount(pane('starfleet-console', 'desktop'))
  await ui.press({ key: 'brief' })
  await new Promise(done => setTimeout(done, 20))
  expect(await ui.find({ type: 'Text', text: /dock note/ })).toBeTruthy()
  await ui.unmount()
  // The saved entry keeps its folder name, so a later map change relabels it
  expect((store['log:sess-1'] as { project: string }[])[0]!.project).toBe('harbor')
  expect((await map({ folder: 'harbor', project: '' })).result).toContain('off the map')
  const after = JSON.parse((await callTool($, { tool: 'mcp__starfleet__starfleet_records' }) as { result: string }).result)
  expect(after.log[0].project).toBe('harbor')
})

test('a folder not on the project map is its own project', () => {
  expect(projectFor({ mod: 'Starfleet mod' }, 'MOD')).toBe('Starfleet mod')
  expect(projectFor({ mod: 'Starfleet mod' }, 'Side Work')).toBe('Side Work')
  expect(projectFor({ mod: 'Starfleet mod' }, 'Starfleet mod')).toBe('Starfleet mod')
})
