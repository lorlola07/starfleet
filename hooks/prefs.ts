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
