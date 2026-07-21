import { makeId, nowIso, type ActivityEvent, type DesignSection, type Speaker, type TranscriptEntry } from './domain'
import type { RealtimeConnectionStatus } from './realtime'

export const WORKSPACE_STORAGE_KEY = 'cothinker-workspace-v2'
const LEGACY_STORAGE_KEY = 'cothinker-workspace-v1'
const WORKSPACE_VERSION = 2

export interface WorkspaceState {
  version: typeof WORKSPACE_VERSION
  transcript: TranscriptEntry[]
  sections: DesignSection[]
  events: ActivityEvent[]
  selectedIds: string[]
  scene: string | null
  session: {
    status: RealtimeConnectionStatus
    message: string
  }
}

export type WorkspaceAction =
  | { type: 'add-transcript'; speaker: Speaker; text: string }
  | { type: 'add-event'; label: string; detail: string }
  | { type: 'add-section'; section: DesignSection }
  | { type: 'set-selection'; selectedIds: string[] }
  | { type: 'set-scene'; scene: string }
  | { type: 'set-session'; status: RealtimeConnectionStatus; message: string }
  | { type: 'clear' }

export const emptyWorkspace = (): WorkspaceState => ({
  version: WORKSPACE_VERSION,
  transcript: [],
  sections: [],
  events: [],
  selectedIds: [],
  scene: null,
  session: { status: 'idle', message: 'Connect OpenAI Realtime to start collaborating.' },
})

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case 'add-transcript': {
      const text = action.text.trim()
      if (!text) return state
      return { ...state, transcript: [...state.transcript.slice(-79), { id: makeId('line'), speaker: action.speaker, text, createdAt: nowIso() }] }
    }
    case 'add-event':
      return { ...state, events: [{ id: makeId('event'), label: action.label, detail: action.detail, createdAt: nowIso() }, ...state.events].slice(0, 12) }
    case 'add-section':
      return { ...state, sections: [...state.sections, action.section] }
    case 'set-selection':
      return { ...state, selectedIds: [...new Set(action.selectedIds)].sort() }
    case 'set-scene':
      return { ...state, scene: action.scene }
    case 'set-session':
      return { ...state, session: { status: action.status, message: action.message } }
    case 'clear':
      return emptyWorkspace()
  }
}

export const workspacePersistence = {
  load(storage: Storage): WorkspaceState {
    const current = parseWorkspace(storage.getItem(WORKSPACE_STORAGE_KEY))
    if (current) return current
    const migrated = migrateLegacyWorkspace(storage.getItem(LEGACY_STORAGE_KEY))
    if (migrated) {
      this.save(storage, migrated)
      storage.removeItem(LEGACY_STORAGE_KEY)
      return migrated
    }
    return emptyWorkspace()
  },
  save(storage: Storage, state: WorkspaceState): void {
    storage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify({ ...state, transcript: state.transcript.slice(-80) }))
  },
  clear(storage: Storage): void {
    storage.removeItem(WORKSPACE_STORAGE_KEY)
    storage.removeItem(LEGACY_STORAGE_KEY)
  },
}

function parseWorkspace(raw: string | null): WorkspaceState | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as Partial<WorkspaceState>
    if (parsed.version !== WORKSPACE_VERSION) return undefined
    return {
      version: WORKSPACE_VERSION,
      transcript: validEntries(parsed.transcript),
      sections: validSections(parsed.sections),
      events: validEvents(parsed.events),
      selectedIds: validIds(parsed.selectedIds),
      scene: typeof parsed.scene === 'string' && validScene(parsed.scene) ? parsed.scene : null,
      session: validSession(parsed.session),
    }
  } catch {
    return undefined
  }
}

function migrateLegacyWorkspace(raw: string | null): WorkspaceState | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as { transcript?: unknown; sections?: unknown }
    return { ...emptyWorkspace(), transcript: validEntries(parsed.transcript), sections: validSections(parsed.sections) }
  } catch {
    return undefined
  }
}

function validEntries(value: unknown): TranscriptEntry[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is TranscriptEntry => isRecord(entry) && typeof entry.id === 'string' && typeof entry.text === 'string' && typeof entry.createdAt === 'string' && (entry.speaker === 'human' || entry.speaker === 'voice' || entry.speaker === 'system')).slice(-80)
}

function validSections(value: unknown): DesignSection[] {
  if (!Array.isArray(value)) return []
  return value.filter((section): section is DesignSection => isRecord(section) && typeof section.id === 'string' && typeof section.title === 'string' && typeof section.body === 'string' && typeof section.createdAt === 'string' && Array.isArray(section.elementIds) && section.elementIds.every((id) => typeof id === 'string') && (section.source === 'human' || section.source === 'ai')).slice(-80)
}

function validEvents(value: unknown): ActivityEvent[] {
  if (!Array.isArray(value)) return []
  return value.filter((event): event is ActivityEvent => isRecord(event) && typeof event.id === 'string' && typeof event.label === 'string' && typeof event.detail === 'string' && typeof event.createdAt === 'string').slice(0, 12)
}

function validIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string').slice(0, 500) : []
}

function validScene(scene: string): boolean {
  try {
    const parsed = JSON.parse(scene) as { elements?: unknown }
    return Array.isArray(parsed.elements)
  } catch {
    return false
  }
}

function validSession(value: unknown): WorkspaceState['session'] {
  if (!isRecord(value) || typeof value.message !== 'string' || typeof value.status !== 'string') return emptyWorkspace().session
  const statuses: RealtimeConnectionStatus[] = ['idle', 'connecting', 'connected', 'listening', 'thinking', 'speaking', 'error']
  return statuses.includes(value.status as RealtimeConnectionStatus) ? { status: value.status as RealtimeConnectionStatus, message: value.message } : emptyWorkspace().session
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
