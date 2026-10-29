import { expect, mock, test } from 'claude-code/testing'

// Tests written the way the mods testing guide recommends (code.claude.com/docs/en/plugins/mods/test):
// the kit's own mocks for the clock, store and environment, so time moves only when the test moves
// it; a { deny } stub for a call that should fail; and every stub registered before the first call
// on $. v3.test.tsx holds the wider suite, with its own hand-made engine.

const CORE = {
  plugin: 'starfleet', component: 'Pane', requestId: 'starfleet-core', surface: 'desktop',
  viewport: { columns: 100, rows: 40 },
  props: { title: 'Warp core', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const CONSOLE = {
  plugin: 'starfleet', component: 'Pane', requestId: 'starfleet-console', surface: 'desktop',
  viewport: { columns: 100, rows: 40 },
  props: { title: 'Starfleet', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

// What Claude Code would answer for everything the mod asks while a chat starts and draws; each
// test adds the stubs it checks. Must run before the test's first call on $
function claudeCode(on: any, extra: { toasts?: string[]; prompts?: string[] } = {}) {
  mock.store(on, {})
  mock.env(on, { HOME: '/Users/cap' })
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  on('command.register', () => ({ value: undefined }))
  on('tool.register', () => ({ value: undefined }))
  on('agent.register', () => ({ value: undefined }))
  on('session.start', ($: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'kit-1' }))
  on('session.cwd', () => ({ value: '/Users/cap/MOD' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 20000, window: 200000, percent: 10 }, rateLimits: [] } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', ($: unknown, e: { text: string }) => { extra.toasts?.push(e.text); return { value: undefined } })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
  on('prompt.submit', ($: unknown, e: { text: string }) => { extra.prompts?.push(e.text); return { text: e.text } })
  on('audio.speak', () => ({ value: { synthesizer: 'test' } }))
  on('audio.play', () => ({ value: undefined }))
  on('fs.list', () => ({ value: [] }))
  on('fs.exists', () => ({ value: false }))
  on('fs.read', () => ({ value: '' }))
  on('fs.write', () => ({ value: undefined }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }))
  on('tool.call', () => ({ result: 'ok' }))
  return clock
}

test('Eject core arms for six seconds; a press after that only arms it again', async ($, on) => {
  const toasts: string[] = []
  const prompts: string[] = []
  const clock = claudeCode(on, { toasts, prompts })
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  const core = await $.ui.mount(CORE)

  // The first press arms the core and says how long the window is
  await core.press({ key: 'eject' })
  expect((await core.find({ key: 'eject' }))?.props.label).toBe('Confirm eject')
  expect(toasts.some(t => t.includes('within 6s'))).toBe(true)

  // Seven seconds later the window has closed: the button reads Eject core again, and a press arms
  // it afresh instead of writing a handoff
  await clock.advance(7000)
  await core.unmount()
  const again = await $.ui.mount(CORE)
  expect((await again.find({ key: 'eject' }))?.props.label).toBe('Eject core')
  await again.press({ key: 'eject' })
  expect(prompts.some(t => t.includes('handoff document'))).toBe(false)

  // A second press inside the window ejects: Claude is asked for the handoff
  await clock.advance(2000)
  await again.press({ key: 'eject' })
  expect(prompts.some(t => t.includes('handoff document'))).toBe(true)
  await again.unmount()
})

test('a refused model call leaves the last order titled from the prompt itself', async ($, on) => {
  claudeCode(on)
  // The title model can't be reached: the call rejects in the mod, as { deny } makes it
  on('model.complete', () => ({ deny: 'no model in this test' }))
  await $.session.start({ cwd: '/Users/cap/MOD', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'Please look into why the warp core crashes on startup when the config file is missing' } as never)

  const ui = await $.ui.mount(CONSOLE)
  // No title comes back, so the block shows the prompt's own first words, never a stuck placeholder
  expect(await ui.find({ type: 'Text', text: /LAST ORDER/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Please look into why the warp core/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Summarizing/ })).toBeUndefined()
  await ui.unmount()
})
