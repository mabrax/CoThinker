export type RealtimeConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'error'

export interface RealtimeVoiceClientOptions {
  /** Defaults to /api/realtime/session. */
  sessionEndpoint?: string
  onStatus?: (status: RealtimeConnectionStatus, message?: string) => void
  onUserTranscript?: (transcript: string) => void
  onAssistantTranscript?: (transcript: string) => void
  onToolCall?: (name: RealtimeToolName, args: unknown) => Promise<unknown>
}

export interface RealtimeServerEvent {
  type?: string
  [key: string]: unknown
}
import type { RealtimeToolName } from '../../shared/realtimeTools'
