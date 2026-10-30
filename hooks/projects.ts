import type { EngineInterface, On } from 'claude-code'

import { basename, projectOf } from './shared'

// The project map: folder name → project name, so chats in several folders file under one project
// (app and app-docs both under "Project A"). Kept in $.store, keys in lower case. Records keep
// the folder name as saved and are named through the map when read, so changing the map relabels
// old log entries and missions too. A folder not on the map is its own project.

const MAP_KEY = 'projectMap'
const MAP_TOOL = 'mcp__starfleet__starfleet_project_map'

export type ProjectMap = Record<string, string>

export async function readProjectMap($: EngineInterface): Promise<ProjectMap> {
  const saved = await $.store.get(MAP_KEY)
  return saved && typeof saved === 'object' ? (saved as ProjectMap) : {}
}

// A folder name (or a name already mapped) through the map; anything else stays as it is
export function projectFor(map: ProjectMap, name: string): string {
  return map[name.trim().toLowerCase()] ?? name
}

// The project a chat's folder files under: a worktree counts for the folder it was cut from
export async function projectName($: EngineInterface, cwd: string): Promise<string> {
  return projectFor(await readProjectMap($), basename(projectOf(cwd) ?? cwd))
}

// A project's doc id in the hub's "reports" collection: the hub's own slug rule, so both find the same doc
export function reportId(project: string): string {
  return project.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'mission'
}

export async function withProjects<T extends { project: string }>($: EngineInterface, records: T[]): Promise<T[]> {
  const map = await readProjectMap($)
  return records.map(r => (r.project ? { ...r, project: projectFor(map, r.project) } : r))
}

function listMap(map: ProjectMap): string {
  const rows = Object.entries(map).sort(([a], [b]) => a.localeCompare(b))
  return rows.length ? rows.map(([folder, project]) => `- ${folder} → ${project}`).join('\n') : 'The project map is empty: every folder is its own project.'
}

// The starfleet_project_map tool: no folder lists the map; folder and project files that folder
// under the project; folder with an empty project takes it off the map
async function setMapping($: EngineInterface, folder: string | undefined, project: string | undefined): Promise<string> {
  const map = await readProjectMap($)
  if (!folder) return listMap(map)
  const key = basename(folder.trim()).toLowerCase()
  if (project === undefined) return map[key] ? `${key} files under ${map[key]}.` : `${key} is not on the map, so it is its own project.`
  const name = project.trim()
  if (name) map[key] = name
  else delete map[key]
  await $.store.set(MAP_KEY, map)
  $.ui.invalidate('ui.render')
  return `${name ? `${key} now files under ${name}.` : `${key} is off the map and is its own project again.`}\n\n${listMap(map)}`
}

export async function projectsSessionStart($: EngineInterface) {
  await $.tool.register({
    name: 'starfleet_project_map',
    description: 'Read or change the Starfleet project map, which files chats from a folder under a project name (the log, missions and hub reports use it). No folder: list the map. folder and project: file that folder under the project. folder with project "": take it off the map. Use when the captain says a folder belongs to a project, or asks how folders are filed.',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'The folder name, as the crew decks show it, or its full path' },
        project: { type: 'string', description: 'The project name to file it under; "" takes the folder off the map' },
      },
    },
  })
}

export function registerProjects(on: On) {
  on('tool.call', { tool: MAP_TOOL }, async ($: EngineInterface, e: { folder?: unknown; project?: unknown }) => ({
    result: await setMapping($, typeof e.folder === 'string' && e.folder.trim() ? e.folder : undefined, typeof e.project === 'string' ? e.project : undefined),
  }))
}
