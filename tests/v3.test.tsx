import { expect, test } from 'claude-code/testing'
import { TEST_OR_BUILD } from '../hooks/shared'

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

// Pane ids opened through ui.open, newest last
const opened: string[] = []
// What session.id answers; a test may change it to act out /clear
let sessionId = 'sess-1'

function engine(on: any, run?: (_: unknown, e: { argv: string[] }) => unknown, live?: { name: string; text: string }) {
  const store: Record<string, unknown> = {}
  on('command.register', () => ({ value: { command: 'x' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__starfleet__x' } }))
  on('agent.register', () => ({ value: { agent: 'starfleet:away-team' } }))
  on('ui.open', (_: unknown, e: { id: string }) => (opened.push(e.id), { value: { isPlaced: true } }))
  on('store.get', (_: unknown, e: { key: string }) => ({ value: store[e.key] }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => { store[e.key] = e.value; return { value: undefined } })
  on('store.delete', (_: unknown, e: { key: string }) => { delete store[e.key]; return { value: undefined } })
  on('store.keys', () => ({ value: Object.keys(store) }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 150000, window: 200000, percent: 75 }, rateLimits: [] } }))
  on('session.cwd', () => ({ value: '/Users/cap/MOD' }))
  on('session.id', () => ({ value: sessionId }))
  on('env.get', () => ({ value: '/Users/cap' }))
  if (live) on('fs.read', (_: unknown, e: { path: string }) => (e.path.endsWith(live.name) ? { value: live.text } : { value: '' }))
  on('fs.list', (_: unknown, e: { path: string }) => e.path.endsWith('starfleet-live') ? { value: live ? [{ name: live.name, kind: 'file', size: 1, mtimeMs: Date.now(), isLink: false }] : [] } : ({ value: [{ name: '-Users-cap-MOD', kind: 'dir', size: 0, mtimeMs: Date.now(), isLink: false }, { name: '-Users-cap-old-app', kind: 'dir', size: 0, mtimeMs: Date.now() - 9 * 86400000, isLink: false }] }))
  on('fs.exists', () => ({ value: true }))
  on('fs.stat', (_: unknown, e: { path: string }) => ({ value: { kind: 'dir', size: 0, mtimeMs: e.path.endsWith('old-app') ? Date.now() - 9 * 86400000 : Date.now(), isLink: false } }))
  on('process.run', run ?? (() => ({ value: { exitCode: 0, stdout: ' M hooks/core.tsx\n', stderr: '' } })))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.run', () => ({}))
  // What the engine and other plugins draw beneath starfleet
  on('ui.render', ($: { ui: { resolve: (e: unknown) => { Text: unknown } } }, e: unknown) => {
    const { Text } = $.ui.resolve(e) as { Text: any }
    return <Text>other plugin band</Text>
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('clock.now', () => ({ value: Date.now() }))
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
    expect((await crew.find({ type: 'Text', text: /ABOARD/ }))?.text).toContain('2 ABOARD')
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
    expect((await ui.find({ type: 'Text', text: /COND (GREEN|YELLOW|BORG|RED)/ }))?.text).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /STARDATE \d{4}\.\d{4}\.\d{4}/ }))?.text).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /TIME LOG/ }))?.text).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /MISSION BRIEFING/ }))?.text).toContain('BRIEFING')
    expect((await ui.find({ type: 'Text', text: /STANDING ORDER/ }))?.text).toContain('STANDING ORDER')
    // The captain's log is a capture field and buttons, with no entry list
    expect(await ui.find({ type: 'Button', key: 'sync' })).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'open-log' })).toBeFalsy()
    expect(await ui.find({ type: 'Text', text: /beam up/ })).toBeFalsy()
    expect(await ui.find({ type: 'Button', key: 'sec-bridge' })).toBeFalsy()
    const openSection = async (id: string) => {
      const header = await ui.find({ type: 'Button', key: 'sec-' + id })
      if (header?.text.startsWith('▸')) await ui.press({ key: 'sec-' + id })
    }
    for (const id of ['crew', 'core', 'record']) await openSection(id)
    expect(await ui.find({ type: 'Button', key: 'rescan' })).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /CORE LOAD/ }))?.text).toContain('75%')
    expect((await ui.find({ type: 'Text', text: /DILITHIUM/ }))?.text).toContain('150k of 200k')
    await ui.press({ key: 'sec-core' })
    expect(await ui.find({ type: 'Button', key: 'eject' })).toBeFalsy()
    await ui.press({ key: 'sec-core' })
    await ui.unmount()
  }
  expect(JSON.stringify(store.consoleOpen)).toContain('true')
})

test('the log files entries by kind, and the course follows files changed and builds', async ($, on) => {
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
  await $.ui.select({ plugin: 'starfleet', key: 'log-file', value: 'Idea' })
  await $.ui.input({ plugin: 'starfleet', key: 'log-0', text: 'tribbles as fixtures' })
  expect(JSON.stringify(store['log:' + sessionId])).toContain('Idea: tribbles as fixtures')
  await callTool($, { tool: 'Edit', file_path: '/Users/cap/MOD/a.ts', old_string: 'a', new_string: 'b' })
  await callTool($, { tool: 'Bash', command: 'npm test' })
  expect(await ui.find({ type: 'Text', text: /MISSION ADVANCING/ })).toBeTruthy()
  const detail = await ui.find({ type: 'Text', text: /1 file changed/ })
  expect(detail?.text).toContain('1 green build')
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
  await ui.unmount()
})

test('projects no longer aboard give their sprites back', async ($, on) => {
  const store = engine(on)
  // Eight archived projects hold every sprite
  const sprites = ['picard', 'data', 'geordi', 'worf', 'seven', 'riker', 'troi', 'crusher']
  store.crewAssign = Object.fromEntries(sprites.map((s, i) => [`/Users/cap/archived-${i}`, s]))
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  const run = $.command.run as (input: { command: string; args: string }) => Promise<unknown>
  await run({ command: 'crew', args: '' })
  const crew = store.crew as { path: string; sprite: string }[]
  expect(crew.length).toBe(2)
  expect(new Set(crew.map(c => c.sprite)).size).toBe(2)
  expect(Object.keys(store.crewAssign as object).sort()).toEqual(crew.map(c => c.path).sort())
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
    expect(await ui.find({ type: 'Button', key: 'sync' })).toBeFalsy()
    expect(await ui.find({ type: 'Text', text: /CONDITION|BORG/ })).toBeFalsy()
    if (surface === 'desktop') {
      expect(await ui.find({ type: 'Svg' })).toBeTruthy()
      // Pausing stills the badge and is remembered; resuming brings the chirp back
      await ui.press({ key: 'pause' })
      expect(store.badgePaused).toBe(true)
      expect(JSON.stringify(await ui.find({ type: 'Svg' }))).toContain('paused')
      expect((await ui.find({ type: 'Button', key: 'pause' }))?.props.label).toContain('Resume')
      await ui.press({ key: 'pause' })
      expect(store.badgePaused).toBe(false)
    }
    await ui.press({ key: 'hail' })
    expect(store.focusMode).toBe(false)
    expect(await ui.find({ type: 'Button', key: 'sync' })).toBeTruthy()
    await ui.unmount()
  }

  // /starfleet focus enters it; a plain /starfleet leaves it
  await run({ command: 'starfleet', args: 'focus' })
  expect(store.focusMode).toBe(true)
  await run({ command: 'starfleet', args: '' })
  expect(store.focusMode).toBe(false)
})

test('this session’s sprite holds its deck between tools', async ($, on) => {
  engine(on)
  let finishTool = () => {}
  on('tool.call', () => new Promise(done => { finishTool = () => done({ result: {} }) }))
  on('turn.start', ((_: unknown, e: unknown) => e) as never)
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  await ($.command.run as (input: { command: string; args: string }) => Promise<unknown>)({ command: 'crew', args: '' })
  const deckOfMod = async () => {
    const view = await $.ui.mount(pane('starfleet-crew', 'terminal'))
    const text = JSON.stringify(await view.find({ type: 'Text', text: /this session/ }))
    await view.unmount()
    return ['bridge', 'science', 'engineering', 'sickbay', 'quarters'].find(d => text.includes(d))
  }
  // The scan put MOD (uncommitted changes) in engineering
  expect(await deckOfMod()).toBe('engineering')
  await ($.turn as unknown as { start: (input: object) => Promise<unknown> }).start({ text: 'scan', turnId: 't1' })
  const running = ($.tool as unknown as { call: (input: object) => Promise<unknown> }).call({ tool: 'Grep', pattern: 'warp' })
  await new Promise(r => (globalThis as unknown as { setTimeout: (f: unknown, ms: number) => void }).setTimeout(r, 0))
  expect(await deckOfMod()).toBe('science')
  // The tool finished and no next one is known yet: it stays in science
  finishTool()
  await running
  expect(await deckOfMod()).toBe('science')
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

test('only a test or build command counts as diagnostics', async () => {
  for (const ran of ['npm test', 'cd app && pnpm run build', 'pytest -q', 'tsc -p .', 'make', 'claude plugin test .']) expect(TEST_OR_BUILD.test(ran)).toBe(true)
  for (const other of ['grep -rn make src', 'git commit -m "fix tsc"', 'echo pytest', 'cat Makefile']) expect(TEST_OR_BUILD.test(other)).toBe(false)
})

test('neighbors in the crew line-up never share a shirt color', async ($, on) => {
  const store = engine(on)
  store.crewAssign = { '/Users/cap/MOD': 'data', '/Users/cap/old-app': 'geordi' }
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  await ($.command.run as (input: { command: string; args: string }) => Promise<unknown>)({ command: 'crew', args: '' })
  const crew = store.crew as { sprite: string }[]
  const shirt: Record<string, string> = { picard: 'r', riker: 'r', data: 'y', geordi: 'y', worf: 'y', seven: 'g', troi: 'p', crusher: 't' }
  for (let i = 1; i < crew.length; i++) expect(shirt[crew[i]!.sprite]).not.toBe(shirt[crew[i - 1]!.sprite])
  expect(crew.map(c => c.sprite)).not.toContain('geordi')
})

test('a deck another chat posts moves that project on every console', async ($, on) => {
  // The mock file system decodes that project folder as /Users/cap/old/app
  const post = JSON.stringify({ path: '/Users/cap/old/app', deck: 'engineering', at: Date.now() })
  engine(on, undefined, { name: '-Users-cap-old-app.json', text: post })
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'terminal', isInteractive: true })
  await ($.command.run as (input: { command: string; args: string }) => Promise<unknown>)({ command: 'crew', args: '' })
  const ui = await $.ui.mount(pane('starfleet-crew', 'terminal'))
  // Nine days idle would put it in quarters; the live post puts it in engineering
  expect((await ui.find({ type: 'Text', text: /\bapp\b/ }))?.text).toContain('engineering')
  await ui.unmount()
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
