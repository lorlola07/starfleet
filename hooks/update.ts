import type { EngineInterface } from 'claude-code'

// Update notice: once a day, ask GitHub for the newest Starfleet version, and when it is newer than
// this copy, say in one toast how to update. Installed plugins never update on their own, so this is
// how a captain hears there is a new version. Nothing is sent but the request for the version file

const REMOTE = 'https://raw.githubusercontent.com/lorlola07/starfleet/main/.claude-plugin/plugin.json'
const CHECK_EVERY = 24 * 60 * 60 * 1000

function versionIn(text: unknown): string | undefined {
  try {
    const version = (JSON.parse(String(text)) as { version?: unknown }).version
    return typeof version === 'string' && /^\d+(\.\d+)*$/.test(version) ? version : undefined
  } catch {
    return undefined
  }
}

// True when version a is later than b, part by part (0.4.14 is later than 0.4.9)
export function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d > 0
  }
  return false
}

export async function checkForUpdate($: EngineInterface) {
  const now = await $.clock.now()
  const last = await $.store.get('updateCheckedAt')
  if (typeof last === 'number' && now - last < CHECK_EVERY) return
  await $.store.set('updateCheckedAt', now)
  try {
    const local = versionIn(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`))
    const res = await $.http.fetch(REMOTE)
    const remote = res.ok ? versionIn(res.text) : undefined
    if (local && remote && isNewer(remote, local)) {
      $.ui.toast(`🖖 Starfleet ${remote} is out (you have ${local}). To update, type /plugin update starfleet in the Claude Code message box, then /reload-plugins.`)
    }
  } catch {
    // offline, or the organization blocks the request: try again tomorrow
  }
}
