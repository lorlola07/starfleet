import type { EngineInterface } from 'claude-code'

import { CREW_PALETTE, SHIP_PALETTE, SHIP_ROWS, hashOf, pixels } from './shared'

// The one LCARS palette every part of the mod draws from
export const LCARS = {
  orange: '#ff9966',
  peach: '#ffcc99',
  lilac: '#cc99cc',
  violet: '#9999ff',
  blue: '#9aa9ff',
  gold: '#ffcc33',
  red: '#ff3b3b',
  green: '#5bd46a',
  space: '#07070c',
  panel: '#12121c',
  ink: '#000000',
  text: '#f1ece4',
  dim: '#8c8a96',
} as const

// Every pane keeps its dark LCARS look in the app's light mode too: the tree sits on a dark Box, and
// text with no color of its own (which would follow the light theme to near-black) gets the LCARS
// text color, or the dim one where it asked to be dim. Text inside a colored Text keeps inheriting
type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
export function onDark<T>(tree: T, filled = false): T {
  const paint = (node: unknown, inText: boolean): unknown => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return Array.isArray(node) ? node.map(n => paint(n, inText)) : node
    const el = node as Node
    let props = el.props
    if (el.type === 'Text' && props?.color === undefined && props?.backgroundColor === undefined && (!inText || props?.dimColor)) {
      const { dimColor, ...rest } = props ?? {}
      props = { ...rest, color: dimColor ? LCARS.dim : LCARS.text }
    }
    // The desktop draws Buttons natively in the app's theme and ignores any color the mod gives them,
    // so a plain one turns dark on dark in light mode. The app's own secondary button reads in both;
    // a button that asked for primary keeps it, so a picked tab still stands out
    if (el.type === 'Button' && filled) {
      const { plain, ...rest } = props ?? {}
      return { ...el, props: { ...rest, variant: rest.variant === 'primary' ? 'primary' : 'secondary' } }
    }
    const children = el.children?.map(c => paint(c, inText || el.type === 'Text'))
    return { ...el, ...(props ? { props } : {}), ...(children ? { children } : {}) }
  }
  return { type: 'Box', props: { flexDirection: 'column', backgroundColor: LCARS.space, paddingX: 1, paddingY: 1 }, children: [paint(tree, false)] } as T
}

// The one color for every heading: pane titles, section headings and their swatches. Warnings
// (red alert, assimilation) keep their own colors, since the color is the message
export const HEAD_COLOR = LCARS.peach

// LCARS panels carry a numeric access code; derive a stable one from a label
export function lcarsCode(label: string): string {
  const h = hashOf(label)
  return `${10 + (h % 89)}-${String(1000 + ((h >>> 7) % 9000))}`
}

// ── Sound ──

export async function isMuted($: EngineInterface): Promise<boolean> {
  return (await $.store.get('muted')) === true
}

// A soft LCARS chirp for a button press
// Sound is decoration: neither ever rejects, so callers can fire and forget
export async function chirp($: EngineInterface) {
  try {
    if (!(await isMuted($))) await $.audio.play({ asset: 'assets/chirp.wav' }, { gain: 0.6 })
  } catch {}
}

// The comms whistle when a mission (turn) completes
export async function hail($: EngineInterface) {
  try {
    if (!(await isMuted($))) await $.audio.play({ asset: 'assets/hail.wav' }, { gain: 0.5 })
  } catch {}
}

// ── Svg art ──

// The console's top frame: an LCARS elbow sweeping into a bar, with the ship name and code
export function lcarsFrameSvg(width: number, title: string, code: string, accent: string): string {
  const w = Math.max(240, width)
  // Drawn larger than any pane inside a full-width Box, like the viewscreen, so the surface scales
  // it to fit and the picture never changes with the pane's width
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} 58" width="${FILL_WIDTH}" height="${Math.round((FILL_WIDTH * 58) / w)}">
<path d="M0 58 V22 Q0 0 22 0 H${w - 150} V20 H52 Q40 20 40 32 V58 Z" fill="${accent}"/>
<rect x="${w - 144}" y="0" width="58" height="20" rx="0" fill="${LCARS.lilac}"/>
<rect x="${w - 82}" y="0" width="82" height="20" rx="10" fill="${LCARS.blue}"/>
<text x="${w - 6}" y="15" text-anchor="end" font-family="Antonio,'Arial Narrow',sans-serif" font-size="13" font-weight="700" fill="${LCARS.ink}">${code}</text>
<text x="56" y="45" font-family="Antonio,'Arial Narrow',sans-serif" font-size="22" font-weight="700" letter-spacing="2" fill="${LCARS.text}">${title.replace(/[<&>]/g, '')}</text>
<rect x="4" y="30" width="30" height="6" fill="${LCARS.space}"/><rect x="4" y="42" width="30" height="6" fill="${LCARS.space}"/>
</svg>`
}

// ── Planets: the world under the viewscreen, picked per project to suit its personality ──

type PlanetArt = { defs: string; back?: string; body: string }
type PlanetSpec = { id: string; name: string; draw: (cx: number, cy: number, r: number, hue: number, color?: string) => PlanetArt }

// Every textured planet is clipped to its disc and shaded toward the night side
const disc = (cx: number, cy: number, r: number) => `<clipPath id="pc"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>
<radialGradient id="shade" cx="35%" cy="35%" r="75%"><stop offset=".45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".6"/></radialGradient>`
const ball = (cx: number, cy: number, r: number, from: string, to: string) =>
  `<radialGradient id="pl" cx="35%" cy="35%" r="70%"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></radialGradient>${disc(cx, cy, r)}`
const shaded = (cx: number, cy: number, r: number, inner: string) =>
  `<g clip-path="url(#pc)"><circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#pl)"/>${inner}<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#shade)"/></g>`

// Every planet is painted only in the crew sprites' colors (CREW_PALETTE), so the viewscreen
// and the decks read as one set; gradients and texture between those colors keep them lit
const C = CREW_PALETTE as Record<'s' | 'd' | 'a' | 'r' | 'y' | 'g' | 'h' | 'k' | 'v' | 'b' | 't' | 'n' | 'p', string>
// Light and dark pairs an Uncharted world picks from by its project's hue, when its project has no
// crew member's color to be drawn in
const UNCHARTED = [[C.s, C.n], [C.t, C.k], [C.p, C.b], [C.y, C.n], [C.r, C.r], [C.g, C.k]] as const

export const PLANETS: PlanetSpec[] = [
  { id: 'uncharted', name: 'Uncharted', draw: (cx, cy, r, hue, color) => {
    const [from, to] = color ? [color, C.k] : UNCHARTED[Math.floor(hue / 60) % UNCHARTED.length]!
    return {
      defs: ball(cx, cy, r, from, to),
      body: shaded(cx, cy, r, `<path d="M${cx - r} ${cy - 8} q${r / 2} -10 ${r} 0 t${r} 0 M${cx - r} ${cy + 14} q${r / 2} -8 ${r} 0 t${r} 0" stroke="${from}" stroke-opacity=".45" stroke-width="5" fill="none"/>
<circle cx="${cx + 12}" cy="${cy - 14}" r="5" fill="${to}" opacity=".5"/><circle cx="${cx - 16}" cy="${cy + 20}" r="3" fill="${to}" opacity=".5"/>`),
    }
  } },
  { id: 'classm', name: 'Class M', draw: (cx, cy, r) => ({
    defs: ball(cx, cy, r, C.t, C.k),
    body: `<circle cx="${cx}" cy="${cy}" r="${r + 3}" fill="none" stroke="${C.t}" stroke-opacity=".35" stroke-width="3"/>` + shaded(cx, cy, r,
      `<path d="M${cx - 30} ${cy - 14} q12 -14 26 -6 q8 8 -2 16 q-10 6 -6 16 q-14 4 -20 -8 z" fill="${C.y}" opacity=".9"/>
<path d="M${cx + 6} ${cy + 6} q14 -8 24 2 q4 12 -8 18 q-12 2 -16 -8 z" fill="${C.d}"/>
<path d="M${cx + 10} ${cy - 30} q10 2 14 10 q-8 2 -14 -10 z" fill="${C.h}"/>
<path d="M${cx - 34} ${cy + 2} q20 -6 40 0 M${cx - 10} ${cy - 22} q18 -4 34 2 M${cx - 20} ${cy + 24} q16 -4 30 2" stroke="${C.a}" stroke-opacity=".75" stroke-width="2.5" fill="none" stroke-linecap="round"/>`),
  }) },
  { id: 'gas', name: 'Gas giant', draw: (cx, cy, r) => ({
    defs: ball(cx, cy, r, C.h, C.n),
    body: shaded(cx, cy, r, [C.y, C.d, C.a, C.n, C.s, C.d]
      .map((c, i) => `<rect x="${cx - r}" y="${cy - r + i * (r / 3)}" width="${r * 2}" height="${r / 5 + (i % 2) * 3}" fill="${c}" opacity=".8"/>`).join('')
      + `<ellipse cx="${cx + 12}" cy="${cy + 12}" rx="8" ry="5" fill="${C.r}"/>`),
  }) },
  { id: 'ringed', name: 'Ringed world', draw: (cx, cy, r) => {
    const ring = (half: 'back' | 'front') => `<g clip-path="url(#${half})"><ellipse cx="${cx}" cy="${cy}" rx="${r + 26}" ry="10" fill="none" stroke="${C.y}" stroke-width="4" stroke-opacity=".8" transform="rotate(-12 ${cx} ${cy})"/><ellipse cx="${cx}" cy="${cy}" rx="${r + 18}" ry="7" fill="none" stroke="${C.s}" stroke-width="2" stroke-opacity=".7" transform="rotate(-12 ${cx} ${cy})"/></g>`
    return {
      defs: ball(cx, cy, r - 4, C.p, C.k) + `<clipPath id="back"><rect x="0" y="0" width="${cx * 2}" height="${cy}"/></clipPath><clipPath id="front"><rect x="0" y="${cy}" width="${cx * 2}" height="${cy * 2}"/></clipPath>`,
      back: ring('back'),
      body: shaded(cx, cy, r - 4, `<rect x="${cx - r}" y="${cy - 6}" width="${r * 2}" height="5" fill="${C.g}" opacity=".5"/><rect x="${cx - r}" y="${cy + 8}" width="${r * 2}" height="3" fill="${C.b}" opacity=".5"/>`) + ring('front'),
    }
  } },
  { id: 'ice', name: 'Ice world', draw: (cx, cy, r) => ({
    defs: ball(cx, cy, r, C.a, C.t),
    body: shaded(cx, cy, r, `<ellipse cx="${cx}" cy="${cy - r + 6}" rx="${r * 0.7}" ry="12" fill="${C.a}"/>
<path d="M${cx - 26} ${cy - 4} l14 8 l10 -6 l16 12 M${cx - 10} ${cy + 18} l12 -6 l14 8 M${cx + 4} ${cy - 18} l8 10" stroke="${C.g}" stroke-width="1.5" fill="none"/>`),
  }) },
  { id: 'lava', name: 'Volcanic', draw: (cx, cy, r) => ({
    defs: ball(cx, cy, r, C.r, C.b),
    body: `<circle class="glow" cx="${cx}" cy="${cy}" r="${r + 4}" fill="none" stroke="${C.r}" stroke-opacity=".35" stroke-width="4"/>` + shaded(cx, cy, r,
      `<path class="glow" d="M${cx - 30} ${cy - 10} l12 6 l8 -10 l14 8 l10 -4 l14 10 M${cx - 20} ${cy + 16} l10 -8 l12 6 l16 -6 M${cx + 2} ${cy - 30} l-4 12 l8 8" stroke="${C.y}" stroke-width="2.5" fill="none" stroke-linejoin="round"/>
<circle class="glow" cx="${cx - 8}" cy="${cy + 2}" r="4" fill="${C.h}"/>`),
  }) },
  { id: 'desert', name: 'Desert', draw: (cx, cy, r) => ({
    defs: ball(cx, cy, r, C.h, C.n),
    body: shaded(cx, cy, r, [-20, -6, 8, 22].map((dy, i) =>
      `<path d="M${cx - r} ${cy + dy} q${r / 2} -8 ${r} 0 t${r} 0" stroke="${C.d}" stroke-width="2" fill="none" opacity="${0.5 + i * 0.1}"/>`).join('')),
  }) },
  { id: 'dilithium', name: 'Dilithium', draw: (cx, cy, r) => ({
    defs: ball(cx, cy, r, C.p, C.k),
    body: shaded(cx, cy, r, [[-16, -12], [10, -20], [18, 8], [-6, 16], [-24, 10], [4, -2]].map(([dx, dy], i) =>
      `<path class="spark" style="animation-delay:calc(${i * 0.4}s + var(--g))" d="M${cx + dx!} ${cy + dy! - 5} l4 5 l-4 5 l-4 -5 z" fill="${C.a}"/>`).join('')),
  }) },
  { id: 'disco', name: 'Disco ball', draw: (cx, cy, r) => {
    // Mirror tiles in rows that narrow toward the poles, each a sprite color; some flash in turn
    const glints = [C.a, C.g, C.t, C.p, C.h, C.s, C.r, C.y]
    let tiles = ''
    const size = 7
    for (let y = cy - r; y < cy + r; y += size) {
      const half = Math.sqrt(Math.max(0, r * r - (y + size / 2 - cy) ** 2))
      const step = Math.max(4, size * (half / r))
      for (let x = cx - half, i = 0; x < cx + half; x += step, i++) {
        const k = Math.abs(Math.round(x * 7 + y * 13)) % 11
        const color = k < 6 ? (k % 2 ? C.g : C.v) : glints[k % glints.length]!
        tiles += `<rect${k >= 9 ? ` class="spark" style="animation-delay:calc(${(k + i) % 6 * 0.3}s + var(--g))"` : ''} x="${x.toFixed(1)}" y="${y}" width="${(step - 1).toFixed(1)}" height="${size - 1}" fill="${color}"/>`
      }
    }
    const beams = [[-1, -1], [1, -0.6], [-0.7, 1], [0.9, 0.9]].map(([dx, dy], i) =>
      `<line class="glow" style="animation-delay:calc(${i * 0.6}s + var(--g))" x1="${cx}" y1="${cy}" x2="${cx + dx! * 140}" y2="${cy + dy! * 70}" stroke="${glints[i * 2]!}" stroke-opacity=".18" stroke-width="6"/>`).join('')
    return {
      defs: ball(cx, cy, r, C.a, C.v),
      back: beams + `<line x1="${cx}" y1="0" x2="${cx}" y2="${cy - r}" stroke="${C.g}" stroke-width="1.5"/>`,
      body: shaded(cx, cy, r, tiles) + `<path class="spark" d="M${cx - 14} ${cy - 22} l3 7 l7 3 l-7 3 l-3 7 l-3 -7 l-7 -3 l7 -3 z" fill="${C.a}"/>`,
    }
  } },
]

export function planetOf(id: string | undefined): PlanetSpec {
  return PLANETS.find(p => p.id === id) ?? PLANETS[0]!
}

// The viewscreen: the ship in standard orbit around a planet for this project. Always laid out on
// one wide canvas (so the planet, orbit and captions never crowd each other) and drawn larger than
// any pane, so the surface scales the whole picture down to fill its slot edge to edge
export const FILL_WIDTH = 1600

// The viewscreen. Given the clock, each animation starts as far along its loop as the clock says,
// so a picture the desktop rebuilds on a redraw carries on instead of snapping back to the start.
// isHeld pauses the animations where that clock puts them: the console passes a frozen clock with
// it, so the source stays the same across the per-tick redraws of a pane that holds the keyboard
export function viewscreenSvg(project: string, tint: 'none' | 'red' | 'borg', planetId: string | undefined, color?: string, now?: number, isHeld = false): string {
  // As wide as the ship's orbit needs and no wider, so the planet fills more of the frame
  const w = 400
  const h = 190
  const hue = hashOf(project) % 360
  const spec = planetOf(planetId)
  const sky = tint === 'red' ? '#1d0707' : tint === 'borg' ? '#06140a' : '#05060f'
  const cx = Math.round(w / 2)
  const cy = 82
  const along = (loopMs: number, delayS = 0) => `${Number((delayS - (now === undefined ? 0 : (now % loopMs) / 1000)).toFixed(3))}s`
  let stars = ''
  let s = hashOf(project + 'stars')
  for (let i = 0; i < Math.round(w / 7); i++) {
    s = (s * 1103515245 + 12345) % 2147483648
    const x = s % w
    s = (s * 1103515245 + 12345) % 2147483648
    stars += `<rect class="tw" style="animation-delay:${along(3000, (s % 30) / 10)}" x="${x}" y="${s % h}" width="${s % 9 === 0 ? 2 : 1}" height="${s % 9 === 0 ? 2 : 1}" fill="#dfe6ff"/>`
  }
  const ship = pixels(SHIP_ROWS, SHIP_PALETTE, 2)
  const art = spec.draw(cx, cy, 54, hue, color)
  // Drawn larger than any pane, so the surface scales it down to fill its slot edge to edge
  // (height follows the same 'w by h' shape)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${FILL_WIDTH}" height="${Math.round((FILL_WIDTH * h) / w)}">
<defs><clipPath id="vs"><rect width="${w}" height="${h}" rx="10"/></clipPath>
${art.defs}</defs>
<style>
@keyframes tw{0%,100%{opacity:.25}50%{opacity:1}}
@keyframes orbit{0%{transform:translate(${cx - 150}px,${cy - 6}px) scale(1)}25%{transform:translate(${cx}px,${cy + 30}px) scale(1.25)}50%{transform:translate(${cx + 150}px,${cy - 6}px) scale(1)}50.01%{transform:translate(${cx + 150}px,${cy - 6}px) scale(-1,1)}75%{transform:translate(${cx}px,${cy - 44}px) scale(-.8,.8)}100%{transform:translate(${cx - 150}px,${cy - 6}px) scale(-1,1)}}
@keyframes behind{0%,50%{opacity:1}55%,95%{opacity:0}100%{opacity:1}}
.tw{animation:tw 3s ease-in-out infinite}
@keyframes glow{0%,100%{opacity:.7}50%{opacity:1}}
@keyframes spark{0%,70%,100%{opacity:.3}80%{opacity:1}}
.ship{animation:orbit 16s linear infinite;animation-delay:${along(16000)}}
.glow{animation:glow 2.4s ease-in-out infinite;animation-delay:${along(2400)}}
.spark{animation:spark 2.4s steps(3) infinite;animation-delay:${along(2400)}}
${isHeld ? '.tw,.ship,.glow,.spark{animation-play-state:paused}' : ''}
@media (prefers-reduced-motion:reduce){.tw,.ship,.glow,.spark{animation:none}.ship{transform:translate(${cx - 150}px,${cy - 6}px)}}
</style>
<g clip-path="url(#vs)">
<rect width="${w}" height="${h}" fill="${sky}"/>${stars}
<ellipse cx="${cx}" cy="${cy}" rx="155" ry="40" fill="none" stroke="${LCARS.blue}" stroke-opacity=".18" stroke-dasharray="3 5"/>
${art.back ?? ''}${art.body}
<g class="ship">${ship}</g>
</g>
<rect x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="10" fill="none" stroke="${tint === 'red' ? LCARS.red : tint === 'borg' ? LCARS.green : LCARS.blue}" stroke-opacity=".7"/>
<text x="16" y="${h - 14}" font-family="Antonio,'Arial Narrow',sans-serif" font-size="13" letter-spacing="1.5" fill="${LCARS.peach}">STANDARD ORBIT · ${project.toUpperCase().replace(/[<&>]/g, '').slice(0, 22)}</text>
<text x="${w - 16}" y="${h - 14}" text-anchor="end" font-family="Antonio,'Arial Narrow',sans-serif" font-size="13" letter-spacing="1.5" fill="${LCARS.lilac}">${spec.name.toUpperCase()}</text>
</svg>`
}

// ── Focus mode: the 8-bit comms badge ──

const BADGE_PALETTE: Record<string, string> = {
  k: '#1a1408', s: '#c9c7d4', w: '#fff2b0', g: '#ffcc33', G: '#c9952a',
}

// The Starfleet delta over its silver oval, 25 by 23 pixels
const BADGE_ROWS = [
  '............k............',
  '...........kgk...........',
  '...........kgk...........',
  '..........kwgGk..........',
  '..........kwgGk..........',
  '.........kwwgGGk.........',
  '.........kwwgGGk.........',
  '......kkkkwwgGGkkkk......',
  '...kkksskwwggGGGksskkk...',
  '..kssssskwwggGGGksssssk..',
  '.kssssskwwgggGGGGksssssk.',
  'ksssssskwwgggGGGGkssssssk',
  'ksssssskwwgggGGGGkssssssk',
  'kssssskwwggggGGGGGksssssk',
  '.ksssskwwggggGGGGGkssssk.',
  '..ksskwwgggggGGGGGGkssk..',
  '...kkkwwgggggGGGGGGkkk...',
  '.....kwwggggkGGGGGGk.....',
  '....kwwggggk.kGGGGGGk....',
  '....kwwgggk...kGGGGGk....',
  '...kwwggkk.....kkGGGGk...',
  '...kwwgk.........kGGGk...',
  '....kkk...........kkk....',
]

// One side's comm wave: a ring of square pixels from -35° to 35°, snapped to the pixel grid
function waveArc(cx: number, cy: number, r: number, side: 1 | -1, px: number): string {
  const seen = new Set<string>()
  let out = ''
  for (let deg = -35; deg <= 35; deg += 4) {
    const a = (deg * Math.PI) / 180
    const x = Math.round((cx + side * r * Math.cos(a)) / px) * px
    const y = Math.round((cy + r * Math.sin(a)) / px) * px
    if (seen.has(`${x},${y}`)) continue
    seen.add(`${x},${y}`)
    out += `<rect x="${x}" y="${y}" width="${px}" height="${px}"/>`
  }
  return out
}

// The comms badge for focus mode: it chirps (a hop), sends pixel waves out both sides,
// and its delta glints. Stepped timing keeps the motion 8-bit
// Paused, every part holds still in its resting pose, as under reduced motion
export function commsBadgeSvg(isPaused = false): string {
  const px = 8
  const w = 320
  const h = 236
  const dx = (w - 25 * px) / 2
  const dy = 14
  const cx = w / 2
  const cy = dy + 12 * px
  const waves = [0, 1, 2].map(i =>
    `<g class="wv" style="animation-delay:${i * 0.25}s">${waveArc(cx, cy, 112 + i * 18, -1, 6)}${waveArc(cx, cy, 112 + i * 18, 1, 6)}</g>`,
  ).join('')
  const glint = (x: number, y: number, delay: number) =>
    `<rect class="gl" style="animation-delay:${delay}s" x="${dx + x * px}" y="${dy + y * px}" width="${px}" height="${px}" fill="#ffffff"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
<style>
@keyframes hop{0%,8%,100%{transform:translateY(0)}4%{transform:translateY(-6px)}}
@keyframes wv{0%,10%{opacity:0}14%,30%{opacity:1}44%,100%{opacity:0}}
@keyframes gl{0%,100%{opacity:0}6%,12%{opacity:1}}
@keyframes halo{0%,100%{opacity:.08}6%{opacity:.35}}
@keyframes blink{0%,49%{opacity:1}50%,100%{opacity:0}}
.badge{animation:hop 3s steps(2) infinite}
.wv{fill:${LCARS.blue};opacity:0;animation:wv 3s steps(4) infinite}
.gl{opacity:0;animation:gl 3s steps(2) infinite}
.halo{animation:halo 3s steps(3) infinite}
.cur{animation:blink 1s steps(1) infinite}
${isPaused ? '.badge,.wv,.gl,.halo,.cur{animation:none}.wv,.gl{opacity:0}' : '@media (prefers-reduced-motion:reduce){.badge,.wv,.gl,.halo,.cur{animation:none}.wv,.gl{opacity:0}}'}
.off{display:none}
svg:hover :is(.badge,.wv,.gl,.halo,.cur){animation-play-state:paused}
svg:hover .on{display:none}
svg:hover .off{display:inline}
</style>
<ellipse class="halo" cx="${cx}" cy="${cy}" rx="120" ry="70" fill="${LCARS.gold}" opacity=".08"/>
${waves}
<g class="badge">${pixels(BADGE_ROWS, BADGE_PALETTE, px, dx, dy)}${glint(12, 1, 0.1)}${glint(10, 7, 0.3)}${glint(1, 11, 0.5)}</g>
<text x="${cx}" y="${h - 14}" text-anchor="middle" font-family="Antonio,'Arial Narrow',sans-serif" font-size="14" font-weight="700" letter-spacing="3" fill="${LCARS.peach}"><tspan class="on">STARFLEET COMMS<tspan class="cur" fill="${LCARS.gold}"> ▮</tspan></tspan><tspan class="off">COMMS PAUSED</tspan></text>
</svg>`
}
