import type { EngineInterface } from 'claude-code'

import { serial } from './shared'

// The voyage: this session's time log and how far the project has come, kept in $.store per
// session (log.tsx's trackSession drops old sessions' keys). Fed by ops.tsx's tool.call hook
// and turn.complete; read by the console.

export type Voyage = {
  startedAt: number
  warpMs: number
  orders: number
  files: string[]
  scans: number
  greenBuilds: number
  lastBuild: 'pass' | 'fail' | null
  commits: number
}

async function voyageKey($: EngineInterface) {
  return `voyage:${await $.session.id()}`
}

export async function readVoyage($: EngineInterface): Promise<Voyage> {
  const saved = (await $.store.get(await voyageKey($))) as Partial<Voyage> | undefined
  return {
    startedAt: saved?.startedAt ?? (await $.clock.now()),
    warpMs: saved?.warpMs ?? 0,
    orders: saved?.orders ?? 0,
    files: saved?.files ?? [],
    scans: saved?.scans ?? 0,
    greenBuilds: saved?.greenBuilds ?? 0,
    lastBuild: saved?.lastBuild ?? null,
    commits: saved?.commits ?? 0,
  }
}

const voyageLock = serial()

export async function updateVoyage($: EngineInterface, fn: (v: Voyage) => Voyage) {
  await voyageLock(async () => $.store.set(await voyageKey($), fn(await readVoyage($))))
}

// Stages of a voyage, from orbit to a landing (a commit); the console draws them as a meter
export const COURSE = ['HOLDING ORBIT', 'SURVEYING', 'UNDER WAY', 'MISSION ADVANCING', 'LANDING PARTY ASHORE'] as const

export function courseOf(v: Voyage): { stage: number; label: string; detail: string; isBreach: boolean } {
  const files = v.files.length
  const parts = [
    files && `${files} file${files === 1 ? '' : 's'} changed`,
    v.greenBuilds && `${v.greenBuilds} green build${v.greenBuilds === 1 ? '' : 's'}`,
    v.commits && `${v.commits} commit${v.commits === 1 ? '' : 's'}`,
  ].filter(Boolean) as string[]
  const stage = v.commits ? 4 : v.greenBuilds && files ? 3 : files ? 2 : v.scans ? 1 : 0
  if (v.lastBuild === 'fail') return { stage, label: 'HULL BREACH', detail: ['last build failed', ...parts].join(' · '), isBreach: true }
  const detail = parts.length ? parts.join(' · ') : v.scans ? `${v.scans} sensor sweeps, nothing changed yet` : 'no course plotted'
  return { stage, label: COURSE[stage]!, detail, isBreach: false }
}

export function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h}h ${m}m` : m ? `${m}m ${s % 60}s` : `${s}s`
}
