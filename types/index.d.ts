export type ServiceRecord = { sessions: number; turns: number; blocked: number; scans: number }

export type StationCall = { id: string; tool: string; station: string; isDone: boolean; isErrored: boolean }

export type Activity = {
  current: StationCall | null
  turnStartedAt: number | null
  turnCalls: number
  recent: StationCall[]
}

export type RedAlert = { isOn: boolean; reason: string }

export type LogEntry = { id: string; stardate: string; text: string; at: number; project: string }

export type Mission = {
  id: string; stardate: string; at: number; project: string; turns: number; redAlerts: number; handoffs: number
  // The mission record; missions saved before it have none of these
  cwd?: string
  endedAt?: number
  models?: string[]
  peakContext?: number
  tools?: Record<string, number>
  skills?: string[]
  agents?: string[]
}

export type Deck = 'bridge' | 'science' | 'engineering' | 'sickbay' | 'quarters'

export type CrewMember = { path: string; project: string; sprite: string; name: string; deck: Deck; status: string; isCurrent: boolean }

declare module 'claude-code' {
  interface PluginState {
    starfleet: {
      isCaptainMode: boolean
      record: ServiceRecord
      activity: Activity
      redAlert: RedAlert
      assimilation: number
    }
  }
}
