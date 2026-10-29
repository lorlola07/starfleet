// Pure helpers and art shared by the starfleet modules. Nothing here touches $.

// Each captain publishes their own Starfleet Command hub from assets/hub.html; its link is kept in $.store
export const HUB_TEMPLATE = 'assets/hub.html'
export function isHubUrl(url: string): boolean {
  return /^https:\/\/claude\.ai\/(code\/)?artifact\/[A-Za-z0-9-]+\/?$/.test(url)
}

// The actual local date, written as a stardate: month and day, then the year's last two digits.
// 1027.26 is 27 Oct 2026
export function stardate(ms: number): string {
  const d = new Date(ms)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${two(d.getMonth() + 1)}${two(d.getDate())}.${two(d.getFullYear() % 100)}`
}

// A worktree session counts for the project it was cut from
export const projectOf = (cwd: string | undefined) => cwd?.replace(/\/\.claude\/worktrees\/.*$/, '')

export function basename(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() || path
}

export function hashOf(text: string): number {
  let h = 0
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h
}

// Pixel art: one string per row, one character per pixel, '.' is empty
export function pixels(rows: readonly string[], palette: Record<string, string>, size = 1, dx = 0, dy = 0): string {
  let out = ''
  rows.forEach((row, y) =>
    [...row].forEach((c, x) => {
      if (c !== '.' && palette[c]) out += `<rect x="${dx + x * size}" y="${dy + y * size}" width="${size}" height="${size}" fill="${palette[c]}"/>`
    }),
  )
  return out
}

export const CREW_PALETTE: Record<string, string> = {
  s: '#f2c6a8', d: '#8a4a2a', a: '#f3e3c0', r: '#e0443e', y: '#e8a33a', g: '#b9b6c4', h: '#f6cf6a',
  k: '#1c1c22', v: '#8c8a96', b: '#3a2a22', t: '#4aa3c7', n: '#6b3e24', p: '#9b6bb5',
  f: '#e88fb4', x: '#34343e', u: '#4caf50', q: '#e0a070', o: '#2e7d32', z: '#f0a050',
}

// Same maps as the Starfleet Command hub, so a crew member looks the same everywhere
export const SPRITES: Record<string, { name: string; emoji: string; rows: string[] }> = {
  picard: { name: 'Picard', emoji: '🟥', rows: ['..ssss..', '.ssssss.', '.sksskk.', '.ssssss.', '..ssss..', '.rrrrrr.', 'rkrrrrkr', 'rrrrrrrr', '.kk..kk.'] },
  data: { name: 'Data', emoji: '🟧', rows: ['..kkkk..', '.kaaaak.', '.akaaka.', '.aaaaaa.', '..aaaa..', '.yyyyyy.', 'ykyyyyky', 'yyyyyyyy', '.kk..kk.'] },
  geordi: { name: 'Geordi', emoji: '🟨', rows: ['..kkkk..', '.dddddd.', '.vvvvvv.', '.dddddd.', '..dddd..', '.yyyyyy.', 'ykyyyyky', 'yyyyyyyy', '.kk..kk.'] },
  worf: { name: 'Worf', emoji: '🟫', rows: ['.bbbbbb.', 'bdddddbb', 'bdkddkdb', 'bddddddb', '.dddddd.', '.yyyyyy.', 'ygyyyyyy', 'yyyyyyyy', '.kk..kk.'] },
  seven: { name: 'Seven', emoji: '⬜', rows: ['..hhhh..', '.hhhhhh.', 'hskssksh', 'hssssssh', '..ssss..', '.gggggg.', 'gggggggg', '.gggggg.', '.gg..gg.'] },
  riker: { name: 'Riker', emoji: '🔴', rows: ['..nnnn..', '.nssssn.', '.sksskk.', '.nnnnnn.', '..nnnn..', '.rrrrrr.', 'rkrrrrkr', 'rrrrrrrr', '.kk..kk.'] },
  troi: { name: 'Troi', emoji: '🟪', rows: ['.kkkkkk.', 'kkssssk.', 'kskssksk', 'kssssssk', 'k.ssss.k', '.pppppp.', 'pppppppp', '.pppppp.', '.pp..pp.'] },
  // Guinan tends bar in Ten Forward, so her tag is an ale rather than a square; like Riker's circle,
  // it comes late in the order
  guinan: { name: 'Guinan', emoji: '🍺', rows: ['.ffffff.', 'ffffffff', '.dddddd.', '.dkddkd.', '..dddd..', '.ffffff.', 'ffffffff', 'ffffffff', '.ff..ff.'] },
  // Q in his court robe (black, gold chain of office)
  q: { name: 'Q', emoji: '⬛', rows: ['..nnnn..', '.nssssn.', '.skssks.', '.ssssss.', '..ssss..', '.xhhhhx.', 'xxxhhxxx', 'xxxxxxxx', '.xx..xx.'] },
  // The Gorn took Quark's green square; a project that had Quark is moved to the Gorn
  gorn: { name: 'Gorn', emoji: '🟩', rows: ['.uuuuuu.', 'uuuuuuuu', 'uhkuukhu', 'uuuuuuuu', '.uoooou.', 'uuuuuuuu', 'uouuuuou', 'uuuuuuuu', '.oo..oo.'] },
  crusher: { name: 'Crusher', emoji: '🟦', rows: ['.rrrrrr.', 'rrssssrr', 'rskssksr', '.ssssss.', '..ssss..', '.tttttt.', 'tkttttkt', 'tttttttt', '.kk..kk.'] },
  // The cast past the squares: picture tags, like Guinan's ale
  tasha: { name: 'Tasha', emoji: '⚡', rows: ['.hhhhhh.', 'hhsssshh', '.skssks.', '.ssssss.', '..ssss..', '.yyyyyy.', 'ykyyyyky', 'yyyyyyyy', '.kk..kk.'] },
  wesley: { name: 'Wesley', emoji: '🩷', rows: ['..nnnn..', '.nssssn.', '.skssks.', '.ssssss.', '..ssss..', '.ffffff.', 'ffggggff', 'ffffffff', '.kk..kk.'] },
  tribble: { name: 'Tribble', emoji: '🧶', rows: ['........', '........', '..dndn..', '.dndndn.', 'dndndndn', 'ndndndnd', 'dndndndn', '.ndndnd.', '..dndn..'] },
  spot: { name: 'Spot', emoji: '🐈', rows: ['........', '.z....z.', '.zz..zz.', '.zzzzzz.', '.zkzzkz.', '.zzfzzz.', '.zyzyzz.', '.zzzzzz.', '.zz..zz.'] },
}

// Sprites the cast no longer has, and who took their place
export const RETIRED_SPRITES: Record<string, string> = { quark: 'gorn' }

// The most crew aboard at once: more won't fit on the viewscreen and the decks
export const CREW_MAX = 11
// Handed out in this order; neighbors in it never share a shirt color
// Each crew member's tag, near their uniform color: shown on the crew decks and in front of
// the name of every chat in that member's project, so a chat and its crew member match
const TAG_EMOJI = /^(?:(?:\u{1F7E5}|\u{1F7E7}|\u{1F7E8}|\u{1F7E9}|\u{1F7E6}|\u{1F7EA}|\u{1F7EB}|\u2B1B|\u2B1C|\u{1F37A}|\u{1FA77}|⚡|\u{1F9F6}|\u{1F408}|\u{1F534}|\u{1F7E0}|\u{1F7E1}|\u{1F7E2}|\u{1F535}|\u{1F7E3}|\u{1F7E4}|\u26AB|\u26AA)\uFE0F?\s*)+/u
export function taggedTitle(title: string, emoji: string): string {
  return `${emoji} ${title.replace(TAG_EMOJI, '').trim() || 'New session'}`
}

// The title with any crew emoji taken off the front; an untagged title comes back as it was
export function untaggedTitle(title: string): string {
  return TAG_EMOJI.test(title) ? title.replace(TAG_EMOJI, '').trim() || 'New session' : title
}

// The whole cast, in the order newcomers get them: the squares first, then the picture tags, then
// Riker as the backup, since his red matches Picard's. The captain can pick any of them in Manage crew
export const SPRITE_ORDER = ['picard', 'data', 'troi', 'geordi', 'crusher', 'worf', 'gorn', 'seven', 'q', 'tasha', 'wesley', 'tribble', 'spot', 'guinan', 'riker']

// Each crew member's one color, the color of their tag: their project's default planet is drawn in it,
// so the chat's tag, the crew member and the viewscreen all match
export const SPRITE_COLORS: Record<string, string> = {
  picard: '#e0443e', data: '#f08a2c', geordi: '#f2c94c', worf: '#8a4a2a',
  seven: '#e9e6f0', riker: '#e0443e', troi: '#9b6bb5', crusher: '#4aa3c7',
  guinan: '#e88fb4', gorn: '#4caf50', q: '#6a6a80',
  tasha: '#f2d36b', wesley: '#f4a6c8', tribble: '#a0703c', spot: '#f0a050',
}

// The 8-bit placeholder ship, flying right. Swap these rows for your own art.
export const SHIP_ROWS = [
  '..........hhhhhhhhh....',
  '.........hwwwwbwwwwh...',
  '..........hhhhhhhhh....',
  '..............hh.......',
  'gnnnnnnnn...hhhh.......',
  'gnwwwwwwnhhhhhhhhhh....',
  'gnnnnnnnn..hhhhhhh.....',
  '.....hh................',
  'gnnnnnnnn..............',
  'gnwwwwwwn..............',
  'gnnnnnnnn..............',
]
export const SHIP_PALETTE: Record<string, string> = { h: '#c9ccd6', w: '#eef1f6', n: '#8d96a8', b: '#4fb3ff', g: '#4fb3ff' }

// Which deck a tool's work happens on
export function deckOfTool(tool: string): 'bridge' | 'science' | 'engineering' {
  if (/^(Grep|Glob|Read|WebFetch|WebSearch)$/.test(tool) || tool.startsWith('mcp__')) return 'science'
  if (/^(Bash|Edit|Write|NotebookEdit)$/.test(tool)) return 'engineering'
  return 'bridge'
}

// A test or build run: the command at the start of the line or of a shell segment (after ; && || | or a cd),
// so `grep -rn make src` or `git commit -m "fix tsc"` don't count
export const TEST_OR_BUILD = /(?:^|[;&|(]\s*|\bnpx\s+(?:-y\s+)?)(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|build|lint|check)\b|(?:pytest|jest|vitest|mocha|tsc|make|gradle|mvn)\b|(?:cargo|go)\s+(?:test|build)\b|claude\s+plugin\s+test\b)/

// One promise chain per resource: each job waits for the one before, so a read-modify-write
// of a $.store key never interleaves with another (parallel tool calls run these hooks at once)
export function serial() {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(job: () => Promise<T>): Promise<T> => {
    const run = tail.then(job, job)
    tail = run.catch(() => {})
    return run
  }
}

export function errText(err: unknown): string {
  return String(err instanceof Error ? err.message : err).slice(0, 160)
}

// Captain's log categories, in picker order; note is the default. The hub keeps its own copy in
// assets/hub.html (CATS), which must match whenever these change
export const LOG_CATEGORIES = [
  { id: 'note', label: 'Note', emoji: '📝', color: '#cc99cc' },
  { id: 'idea', label: 'Idea', emoji: '💡', color: '#ffcc33' },
  { id: 'bug', label: 'Bug', emoji: '🐞', color: '#ff5555' },
  { id: 'decision', label: 'Decision', emoji: '⚖️', color: '#9aa9ff' },
  { id: 'todo', label: 'To-do', emoji: '☑️', color: '#ff9966' },
] as const
export type LogCategory = (typeof LOG_CATEGORIES)[number]['id']
export function categoryOf(id: unknown) {
  return LOG_CATEGORIES.find(c => c.id === id) ?? LOG_CATEGORIES[0]
}
// "/log idea: cache the scan" files an idea; a note with no known category word before a colon is a note
export function splitCategory(typed: string): { category: LogCategory; text: string } {
  const match = /^\s*(note|idea|bug|decision|to-?do)\s*:\s*/i.exec(typed)
  if (!match) return { category: 'note', text: typed.trim() }
  const word = match[1]!.toLowerCase().replace('-', '') as LogCategory
  return { category: word, text: typed.slice(match[0].length).trim() }
}

// Rank by turns commanded, and the pips that show it
export const RANKS = [
  { at: 0, name: 'Ensign', pips: 1 },
  { at: 5, name: 'Lieutenant', pips: 2 },
  { at: 15, name: 'Commander', pips: 3 },
  { at: 40, name: 'Captain', pips: 4 },
  { at: 100, name: 'Admiral', pips: 5 },
]

export function rankOf(turns: number) {
  return [...RANKS].reverse().find(r => turns >= r.at)!
}

// The rank name as a badge: a gold-edged ribbon with a star per pip. Admiral, the flag rank, gets a
// laurel wreath and a brighter gold. Still art, so a redraw has nothing to restart
// The drawing is 240 by 64; it is shown at 160 wide so it fits a narrow console
export const BADGE_W = 160
export const BADGE_H = 43
const ART_W = 240
const ART_H = 64
export function rankBadgeSvg(rank: { name: string; pips: number }): string {
  const isFlag = rank.pips >= 5
  const [hi, lo] = isFlag ? ['#fff4c2', '#e8a800'] : ['#ffe08a', '#c08a10']
  const mid = ART_W / 2
  const stars = Array.from({ length: rank.pips }, (_, i) => {
    const x = mid + (i - (rank.pips - 1) / 2) * 18
    return `<path transform="translate(${x} 11) scale(.8)" d="M0-9 2.6-2.8 9-2.8 3.8 1.2 5.6 7.6 0 3.8-5.6 7.6-3.8 1.2-9-2.8-2.6-2.8Z" fill="url(#g)"/>`
  }).join('')
  // Leaves curving up each side, mirrored, for the flag rank's wreath
  const leaves = isFlag ? [0, 1, 2, 3, 4].map(i => {
    const y = 56 - i * 9
    const x = 22 + i * 1.5 - (i === 0 || i === 4 ? 0 : 4)
    return `<ellipse cx="${x}" cy="${y}" rx="8" ry="3.4" transform="rotate(${-55 + i * 22} ${x} ${y})" fill="url(#g)"/>`
      + `<ellipse cx="${ART_W - x}" cy="${y}" rx="8" ry="3.4" transform="rotate(${55 - i * 22} ${ART_W - x} ${y})" fill="url(#g)"/>`
  }).join('') : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ART_W} ${ART_H}">`
    + `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hi}"/><stop offset="1" stop-color="${lo}"/></linearGradient></defs>`
    + leaves
    // The ribbon, notched at both ends, with a thin gold rule inside its edge
    + `<path d="M34 24H206L196 41 206 58H34L44 41Z" fill="#1c1508" stroke="url(#g)" stroke-width="2.5" stroke-linejoin="round"/>`
    + `<path d="M41 28H199L191 41 199 54H41L49 41Z" fill="none" stroke="${lo}" stroke-opacity=".5" stroke-width="1"/>`
    + stars
    + `<text x="${mid}" y="47.5" text-anchor="middle" font-family="Antonio,Arial Narrow,sans-serif" font-size="18" font-weight="700" letter-spacing="2" fill="${hi}">${rank.name.toUpperCase().replace(/[<&>]/g, '')}</text>`
    + '</svg>'
}

export function pipsSvg(pips: number): string {
  const circles = Array.from({ length: pips }, (_, i) =>
    `<circle cx="${22 + i * 26}" cy="20" r="9" fill="#ffcc33" stroke="#7a5c00" stroke-width="2"/>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${pips * 26 + 18} 40"><rect width="100%" height="40" rx="6" fill="#111"/>${circles}</svg>`
}
