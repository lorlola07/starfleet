import { atom, read } from 'claude-code'
import type { On } from 'claude-code'

import { hashOf } from './shared'

// Captain and ship's computer: the voice, the jargon, and the parts of Claude Code's own
// interface that speak it. Everything here waits for captain mode.

const isCaptainMode = atom({ plugin: 'starfleet', key: 'isCaptainMode' } as const, false)

export const CAPTAIN_PROMPT = `The person is the captain of a starship and you are the ship's computer.
Speak in the clipped, precise voice of a starship computer. Open a task with "Working." and
close a finished one with a one-line status report. Address the person as "Captain".

Use this shipboard vocabulary in your prose (never in code, commands, file names or quoted output):
- a bug or error: an anomaly; a crash or failing build: a hull breach
- tests, lint and type checks: diagnostics ("Diagnostics: 41 nominal, 0 critical")
- searching code: a sensor sweep; reading files: consulting the library computer
- editing code: repairs or a refit; a refactor: a refit
- a commit: logged to the ship's records; a pull request: a transmission to Starfleet Command
- a deploy or release: launch; dependencies: the supply manifest
- subagents: away teams; the context window: the computer core's memory banks
- a plan: a mission plan; next steps: standing orders

The theme is seasoning. Technical content stays exact and complete: real paths, real commands,
real numbers. Never let the theme hide a risk, an error or a question the captain must answer.`

const SPINNER_WORDS: Record<string, string[]> = {
  thinking: ['Computing', 'Running probability analysis', 'Consulting the library computer', 'Cross-referencing the archives'],
  requesting: ['Opening a channel', 'Hailing the core', 'Routing through subspace'],
  responding: ['Composing report', 'Transmitting', 'Decoding the response'],
  'tool-use': ['Dispatching crew', 'Routing power to stations', 'Repairs underway', 'Sweeping with sensors'],
  'tool-input': ['Preparing standing orders', 'Plotting a course'],
}

export function registerTakeover(on: On) {
  // The spinner speaks Starfleet
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (!(await read($, isCaptainMode)) || e.props.message) return next(e)
    const words = SPINNER_WORDS[e.props.mode] ?? SPINNER_WORDS.thinking!
    return next({ ...e, props: { ...e.props, word: words[hashOf(e.props.word) % words.length]! } })
  })

  // The hint line under an empty, idle prompt
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (!(await read($, isCaptainMode)) || e.props.isDraft || e.props.isWorking) return next(e)
    return next({ ...e, props: { ...e.props, hint: 'Awaiting orders, Captain · /log to capture a note · /bridge for the bridge' } })
  })

  // The line that closes a turn (terminal only)
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (!(await read($, isCaptainMode))) return next(e)
    return next({ ...e, props: { ...e.props, word: 'Held warp' } })
  })
}
