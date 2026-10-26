import { expect, test } from 'claude-code/testing'

const pane = (requestId: string, surface: 'terminal' | 'desktop') =>
  ({
    plugin: 'starfleet',
    component: 'Pane',
    requestId,
    surface,
    props: {
      title: requestId,
      isFocused: false,
      bodyColumns: 50,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 30 },
      view: {},
    },
  }) as const

test('the viewscreen and service record draw on desktop and terminal', async ($, on) => {
  on('command.register', () => ({ value: { command: 'x' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__starfleet__sensor_scan' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['desktop', 'terminal'] as const) {
    const ship = await $.ui.mount(pane('starfleet-ship', surface))
    expect((await ship.find({ type: 'Text', text: /VIEWSCREEN/ }))?.text).toContain('USS CLAUDE')
    await ship.unmount()

    const rec = await $.ui.mount(pane('starfleet-record', surface))
    expect((await rec.find({ type: 'Text', text: /SERVICE RECORD/ }))?.text).toContain('STARFLEET')
    await rec.unmount()
  }
})

test('the live bridge logs a tool call, and the translator draws', async ($, on) => {
  on('command.register', () => ({ value: { command: 'x' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__starfleet__sensor_scan' } }))
  on('agent.register', () => ({ value: { agent: 'starfleet:away-team' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const tools = $.tool as unknown as { call: (input: object) => Promise<unknown> }
  await tools.call({ tool: 'Grep', pattern: 'warp' })

  for (const surface of ['desktop', 'terminal'] as const) {
    const bridge = await $.ui.mount(pane('starfleet-bridge', surface))
    expect((await bridge.find({ type: 'Text', text: /Sensors/ }))?.text).toContain('Grep')
    await bridge.unmount()

    const tr = await $.ui.mount(pane('starfleet-translator', surface))
    expect((await tr.find({ type: 'Text', text: /UNIVERSAL TRANSLATOR/ }))?.text).toContain('TRANSLATOR')
    await tr.unmount()
  }
})
