export type RealtimeConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'error'

export type RealtimeToolArguments = Record<string, unknown>

export interface RealtimeVoiceClientOptions {
  /** Defaults to /api/realtime/session. */
  sessionEndpoint?: string
  onStatus?: (status: RealtimeConnectionStatus, message?: string) => void
  onUserTranscript?: (transcript: string) => void
  onAssistantTranscript?: (transcript: string) => void
  onToolCall?: (name: string, args: RealtimeToolArguments) => Promise<unknown>
}

export interface RealtimeServerEvent {
  type?: string
  [key: string]: unknown
}
