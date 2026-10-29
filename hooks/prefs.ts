import type { EngineInterface } from 'claude-code'

// Whether starfleet may send text to a small model (Haiku) on its own: a short title for each
// long prompt, and the mission briefing from handoff notes and log entries. On unless the captain
// runs /ai-summaries off; then titles come from the prompt's first line and the briefing from the log.
// The translator calls a model only when the captain uses it.
const AI_KEY = 'aiSummaries'

export async function isAiOn($: EngineInterface): Promise<boolean> {
  return (await $.store.get(AI_KEY)) !== false
}

export async function setAi($: EngineInterface, isOn: boolean) {
  await $.store.set(AI_KEY, isOn)
}

// The band above the prompt (the gliding ship while Claude works, red alert, the warp core
// warning): on unless the captain turns it off with the console's Band button or /band off. Off,
// the warp core pane and the console still show the same warnings
const BAND_KEY = 'bandHidden'

export async function isBandOn($: EngineInterface): Promise<boolean> {
  return (await $.store.get(BAND_KEY)) !== true
}

export async function setBand($: EngineInterface, isOn: boolean) {
  await $.store.set(BAND_KEY, !isOn)
  $.ui.invalidate('ui.render')
}
