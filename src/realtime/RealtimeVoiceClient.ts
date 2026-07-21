import type {
  RealtimeConnectionStatus,
  RealtimeServerEvent,
  RealtimeVoiceClientOptions,
} from './types'
import { isRealtimeToolName } from '../../shared/realtimeTools'

const DATA_CHANNEL_LABEL = 'oai-events'
const DEFAULT_SESSION_ENDPOINT = '/api/realtime/session'

interface FunctionCall {
  callId: string
  name: string
  arguments: unknown
}

export class RealtimeVoiceClient {
  private readonly options: RealtimeVoiceClientOptions
  private peerConnection?: RTCPeerConnection
  private dataChannel?: RTCDataChannel
  private microphoneStream?: MediaStream
  private audioElement?: HTMLAudioElement
  private abortController?: AbortController
  private connectPromise?: Promise<void>
  private readonly assistantTranscriptBuffers = new Map<string, string>()
  private readonly reportedAssistantItems = new Set<string>()
  private readonly handledCallIds = new Set<string>()

  constructor(options: RealtimeVoiceClientOptions = {}) {
    this.options = options
  }

  get isConnected(): boolean {
    return this.dataChannel?.readyState === 'open'
  }

  connect(): Promise<void> {
    if (this.isConnected) return Promise.resolve()
    if (this.connectPromise) return this.connectPromise

    this.connectPromise = this.connectInternal().finally(() => {
      this.connectPromise = undefined
    })
    return this.connectPromise
  }

  disconnect(): void {
    this.resetConnection(true)
    this.updateStatus('idle')
  }

  sendText(text: string): void {
    const normalized = text.trim()
    if (!normalized) return
    this.assertConnected()

    this.notifyUserTranscript(normalized)
    this.sendEvent({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: normalized }],
      },
    })
    this.sendEvent({ type: 'response.create' })
    this.updateStatus('thinking')
  }

  interrupt(): void {
    if (!this.isConnected) return
    this.sendEvent({ type: 'response.cancel' })
    this.updateStatus('listening', 'Interrupted')
  }

  private async connectInternal(): Promise<void> {
    if (typeof RTCPeerConnection === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      const message = 'Voice chat needs a modern browser with microphone and WebRTC support.'
      this.updateStatus('error', message)
      throw new Error(message)
    }

    this.updateStatus('connecting', 'Requesting microphone access…')
    const abortController = new AbortController()
    this.abortController = abortController

    try {
      const peerConnection = new RTCPeerConnection()
      this.peerConnection = peerConnection
      this.installPeerConnectionHandlers(peerConnection)

      const audioElement = document.createElement('audio')
      audioElement.autoplay = true
      audioElement.setAttribute('playsinline', '')
      this.audioElement = audioElement

      peerConnection.addEventListener('track', (event) => {
        const stream = event.streams[0] ?? new MediaStream([event.track])
        audioElement.srcObject = stream
        void audioElement.play().catch(() => {
          this.updateStatus('connected', 'Connected. Your browser may require audio playback permission.')
        })
      })

      const microphoneStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      if (abortController.signal.aborted) {
        microphoneStream.getTracks().forEach((track) => track.stop())
        return
      }
      this.microphoneStream = microphoneStream
      for (const track of microphoneStream.getAudioTracks()) {
        peerConnection.addTrack(track, microphoneStream)
      }

      const dataChannel = peerConnection.createDataChannel(DATA_CHANNEL_LABEL)
      this.dataChannel = dataChannel
      this.installDataChannelHandlers(dataChannel)

      const offer = await peerConnection.createOffer()
      await peerConnection.setLocalDescription(offer)
      const sdp = peerConnection.localDescription?.sdp
      if (!sdp) throw new Error('The browser could not create a voice connection offer.')

      this.updateStatus('connecting', 'Starting the voice session…')
      const response = await fetch(this.options.sessionEndpoint ?? DEFAULT_SESSION_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: sdp,
        signal: abortController.signal,
      })
      const answer = await response.text()
      if (!response.ok) throw new Error(readServerError(answer, response.status))

      await peerConnection.setRemoteDescription({ type: 'answer', sdp: answer })
      await waitForDataChannel(dataChannel, abortController.signal)
      this.updateStatus('listening', 'Connected')
    } catch (error) {
      const wasCancelled = abortController.signal.aborted
      this.resetConnection(false)
      if (wasCancelled) {
        this.updateStatus('idle')
        return
      }

      const message = friendlyConnectionError(error)
      this.updateStatus('error', message)
      throw new Error(message, { cause: error })
    }
  }

  private installPeerConnectionHandlers(peerConnection: RTCPeerConnection): void {
    peerConnection.addEventListener('connectionstatechange', () => {
      if (peerConnection.connectionState === 'failed') {
        this.resetConnection(false)
        this.updateStatus('error', 'The voice connection was lost. Please reconnect.')
      }
    })
  }

  private installDataChannelHandlers(dataChannel: RTCDataChannel): void {
    dataChannel.addEventListener('open', () => this.updateStatus('connected', 'Connected'))
    dataChannel.addEventListener('close', () => {
      if (this.peerConnection && this.peerConnection.connectionState !== 'closed') {
        this.resetConnection(false)
        this.updateStatus('idle', 'Voice session ended')
      }
    })
    dataChannel.addEventListener('error', () => {
      this.updateStatus('error', 'The voice event channel encountered an error.')
    })
    dataChannel.addEventListener('message', (message) => {
      let event: RealtimeServerEvent
      try {
        event = JSON.parse(String(message.data)) as RealtimeServerEvent
      } catch {
        return
      }
      this.handleServerEvent(event)
    })
  }

  private handleServerEvent(event: RealtimeServerEvent): void {
    switch (event.type) {
      case 'session.created':
      case 'session.updated':
        this.updateStatus('listening')
        break
      case 'input_audio_buffer.speech_started':
        this.updateStatus('listening', 'Listening…')
        break
      case 'input_audio_buffer.speech_stopped':
      case 'response.created':
        this.updateStatus('thinking', 'Thinking…')
        break
      case 'response.output_audio.delta':
      case 'response.output_audio_transcript.delta':
        this.updateStatus('speaking', 'Speaking…')
        if (event.type === 'response.output_audio_transcript.delta') {
          this.appendAssistantTranscript(event)
        }
        break
      case 'response.output_text.delta':
        this.appendAssistantTranscript(event)
        break
      case 'response.output_audio_transcript.done':
        this.finishAssistantTranscript(event, 'transcript')
        break
      case 'response.output_text.done':
        this.finishAssistantTranscript(event, 'text')
        break
      case 'conversation.item.input_audio_transcription.completed':
        if (typeof event.transcript === 'string' && event.transcript.trim()) {
          this.notifyUserTranscript(event.transcript.trim())
        }
        break
      case 'response.done':
        void this.handleResponseDone(event)
        break
      case 'error':
        this.handleRealtimeError(event)
        break
    }
  }

  private appendAssistantTranscript(event: RealtimeServerEvent): void {
    if (typeof event.delta !== 'string') return
    const key = transcriptKey(event)
    this.assistantTranscriptBuffers.set(
      key,
      `${this.assistantTranscriptBuffers.get(key) ?? ''}${event.delta}`,
    )
  }

  private finishAssistantTranscript(event: RealtimeServerEvent, field: 'text' | 'transcript'): void {
    const key = transcriptKey(event)
    const explicit = event[field]
    const transcript =
      (typeof explicit === 'string' ? explicit : this.assistantTranscriptBuffers.get(key))?.trim() ?? ''
    this.assistantTranscriptBuffers.delete(key)
    if (!transcript || this.reportedAssistantItems.has(key)) return

    this.reportedAssistantItems.add(key)
    this.notifyAssistantTranscript(transcript)
  }

  private async handleResponseDone(event: RealtimeServerEvent): Promise<void> {
    const response = isRecord(event.response) ? event.response : undefined
    const output = response && Array.isArray(response.output) ? response.output : []
    this.reportTranscriptFallback(output)

    const calls = output
      .map(readFunctionCall)
      .filter((call): call is FunctionCall => Boolean(call))
      .filter((call) => !this.handledCallIds.has(call.callId))

    if (calls.length === 0) {
      this.updateStatus('listening')
      return
    }

    for (const call of calls) this.handledCallIds.add(call.callId)
    this.updateStatus('thinking', 'Updating the canvas…')
    const outputs = await Promise.all(calls.map((call) => this.invokeTool(call)))
    if (!this.isConnected) return

    for (const output of outputs) {
      this.sendEvent({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: output.callId,
          output: output.value,
        },
      })
    }
    this.sendEvent({ type: 'response.create' })
  }

  private async invokeTool(call: FunctionCall): Promise<{ callId: string; value: string }> {
    try {
      if (!this.options.onToolCall) {
        throw new Error(`No handler is registered for ${call.name}.`)
      }
      if (!isRealtimeToolName(call.name)) {
        return {
          callId: call.callId,
          value: serializeToolOutput({
            ok: false,
            error: {
              code: 'UNKNOWN_TOOL',
              message: `Unknown realtime tool: ${call.name}`,
            },
          }),
        }
      }
      const result = await this.options.onToolCall(call.name, call.arguments)
      return { callId: call.callId, value: serializeToolOutput(result) }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The tool call failed.'
      return { callId: call.callId, value: JSON.stringify({ error: message }) }
    }
  }

  private reportTranscriptFallback(output: unknown[]): void {
    for (const item of output) {
      if (!isRecord(item) || item.type !== 'message' || !Array.isArray(item.content)) continue
      const itemId = typeof item.id === 'string' ? item.id : 'assistant'
      if (this.reportedAssistantItems.has(itemId)) continue

      const transcript = item.content
        .map((part) => {
          if (!isRecord(part)) return ''
          if (typeof part.transcript === 'string') return part.transcript
          if (typeof part.text === 'string') return part.text
          return ''
        })
        .join('')
        .trim()
      if (!transcript) continue

      this.reportedAssistantItems.add(itemId)
      this.notifyAssistantTranscript(transcript)
    }
  }

  private handleRealtimeError(event: RealtimeServerEvent): void {
    const error = isRecord(event.error) ? event.error : undefined
    const message = error && typeof error.message === 'string' ? error.message : 'The voice service reported an error.'
    this.updateStatus('error', message)
  }

  private sendEvent(event: Record<string, unknown>): void {
    this.assertConnected()
    this.dataChannel?.send(JSON.stringify(event))
  }

  private assertConnected(): void {
    if (!this.isConnected) throw new Error('Voice is not connected. Connect before sending a message.')
  }

  private updateStatus(status: RealtimeConnectionStatus, message?: string): void {
    try {
      this.options.onStatus?.(status, message)
    } catch {
      // Consumer callbacks must not break the WebRTC lifecycle.
    }
  }

  private notifyUserTranscript(transcript: string): void {
    try {
      this.options.onUserTranscript?.(transcript)
    } catch {
      // Consumer callbacks must not break the WebRTC lifecycle.
    }
  }

  private notifyAssistantTranscript(transcript: string): void {
    try {
      this.options.onAssistantTranscript?.(transcript)
    } catch {
      // Consumer callbacks must not break the WebRTC lifecycle.
    }
  }

  private resetConnection(abortRequest: boolean): void {
    if (abortRequest) this.abortController?.abort()
    this.abortController = undefined

    this.dataChannel?.close()
    this.dataChannel = undefined

    this.microphoneStream?.getTracks().forEach((track) => track.stop())
    this.microphoneStream = undefined

    this.peerConnection?.getSenders().forEach((sender) => sender.track?.stop())
    this.peerConnection?.close()
    this.peerConnection = undefined

    if (this.audioElement) {
      this.audioElement.pause()
      this.audioElement.srcObject = null
      this.audioElement.remove()
      this.audioElement = undefined
    }

    this.assistantTranscriptBuffers.clear()
    this.reportedAssistantItems.clear()
    this.handledCallIds.clear()
  }
}

function readFunctionCall(value: unknown): FunctionCall | undefined {
  if (!isRecord(value) || value.type !== 'function_call') return undefined
  if (typeof value.call_id !== 'string' || typeof value.name !== 'string') return undefined

  let args: unknown = {}
  if (typeof value.arguments === 'string' && value.arguments.trim()) {
    try {
      const parsed: unknown = JSON.parse(value.arguments)
      args = parsed
    } catch {
      args = value.arguments
    }
  }
  return { callId: value.call_id, name: value.name, arguments: args }
}

function transcriptKey(event: RealtimeServerEvent): string {
  if (typeof event.item_id === 'string') return event.item_id
  if (typeof event.response_id === 'string') return event.response_id
  return 'assistant'
}

function serializeToolOutput(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value ?? null)
  } catch {
    return String(value)
  }
}

function readServerError(payload: string, status: number): string {
  try {
    const parsed: unknown = JSON.parse(payload)
    if (isRecord(parsed) && typeof parsed.error === 'string') return parsed.error
    if (isRecord(parsed) && isRecord(parsed.error) && typeof parsed.error.message === 'string') {
      return parsed.error.message
    }
  } catch {
    // An SDP or proxy error can be plain text.
  }
  return payload.trim() || `Voice session setup failed (${status}).`
}

function friendlyConnectionError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'Microphone access was denied. Allow microphone access and try again.'
  }
  if (error instanceof DOMException && error.name === 'NotFoundError') {
    return 'No microphone was found. Connect a microphone and try again.'
  }
  if (error instanceof Error && error.message) return error.message
  return 'Voice could not connect. Check your microphone and network, then try again.'
}

function waitForDataChannel(dataChannel: RTCDataChannel, signal: AbortSignal): Promise<void> {
  if (dataChannel.readyState === 'open') return Promise.resolve()
  if (signal.aborted) return Promise.reject(new DOMException('Connection cancelled.', 'AbortError'))

  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      cleanup()
      reject(new Error('Voice connection timed out. Please try again.'))
    }, 15_000)

    const handleOpen = () => {
      cleanup()
      resolve()
    }
    const handleAbort = () => {
      cleanup()
      reject(new DOMException('Connection cancelled.', 'AbortError'))
    }
    const handleClose = () => {
      cleanup()
      reject(new Error('The voice event channel closed before connecting.'))
    }
    const cleanup = () => {
      globalThis.clearTimeout(timeout)
      dataChannel.removeEventListener('open', handleOpen)
      dataChannel.removeEventListener('close', handleClose)
      signal.removeEventListener('abort', handleAbort)
    }

    dataChannel.addEventListener('open', handleOpen, { once: true })
    dataChannel.addEventListener('close', handleClose, { once: true })
    signal.addEventListener('abort', handleAbort, { once: true })
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
