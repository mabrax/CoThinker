import { afterEach, describe, expect, it, vi } from 'vitest'
import { RealtimeVoiceClient } from './RealtimeVoiceClient'

class FakeDataChannel extends EventTarget {
  readyState: RTCDataChannelState = 'connecting'
  readonly sent: string[] = []

  send(data: string): void {
    if (this.readyState !== 'open') throw new Error('Data channel is not open')
    this.sent.push(data)
  }

  open(): void {
    this.readyState = 'open'
    this.dispatchEvent(new Event('open'))
  }

  close(): void {
    if (this.readyState === 'closed') return
    this.readyState = 'closed'
    this.dispatchEvent(new Event('close'))
  }

  receive(payload: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(payload) }))
  }
}

class FakePeerConnection extends EventTarget {
  connectionState: RTCPeerConnectionState = 'connected'
  localDescription: RTCSessionDescriptionInit | null = null
  readonly channel = new FakeDataChannel()
  readonly senders: RTCRtpSender[] = []

  addTrack(track: MediaStreamTrack): RTCRtpSender {
    const sender = { track } as RTCRtpSender
    this.senders.push(sender)
    return sender
  }

  createDataChannel(): RTCDataChannel {
    return this.channel as unknown as RTCDataChannel
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'offer', sdp: 'browser-offer' }
  }

  async setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = description
  }

  async setRemoteDescription(): Promise<void> {
    this.channel.open()
  }

  getSenders(): RTCRtpSender[] {
    return this.senders
  }

  close(): void {
    this.connectionState = 'closed'
  }
}

const peers: FakePeerConnection[] = []
const stopTrack = vi.fn()

function installWebRtcFixture(): void {
  peers.length = 0
  stopTrack.mockReset()
  vi.stubGlobal('RTCPeerConnection', class extends FakePeerConnection {
    constructor() {
      super()
      peers.push(this)
    }
  })
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: vi.fn().mockResolvedValue({
        getTracks: () => [{ stop: stopTrack }],
        getAudioTracks: () => [{ stop: stopTrack }],
      }),
    },
  })
  vi.stubGlobal('document', {
    createElement: () => ({
      autoplay: false,
      srcObject: null,
      setAttribute: vi.fn(),
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      remove: vi.fn(),
    }),
  })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('openai-answer', { status: 201 })))
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('RealtimeVoiceClient', () => {
  it('uses the production WebRTC client to send text, return tool results, and report both transcripts', async () => {
    installWebRtcFixture()
    const statuses: string[] = []
    const userTranscripts: string[] = []
    const assistantTranscripts: string[] = []
    const onToolCall = vi.fn().mockResolvedValue({ ok: true, id: 'proposal-1' })
    const client = new RealtimeVoiceClient({
      onStatus: (status) => statuses.push(status),
      onUserTranscript: (text) => userTranscripts.push(text),
      onAssistantTranscript: (text) => assistantTranscripts.push(text),
      onToolCall,
    })

    await client.connect()
    client.sendText('Add an idea')
    peers[0].channel.receive({
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: 'Spoken design move',
    })
    peers[0].channel.receive({
      type: 'response.output_audio_transcript.delta',
      item_id: 'reply-1',
      delta: 'I added it.',
    })
    peers[0].channel.receive({
      type: 'response.output_audio_transcript.done',
      item_id: 'reply-1',
    })
    peers[0].channel.receive({
      type: 'response.done',
      response: {
        output: [{
          type: 'function_call',
          call_id: 'tool-1',
          name: 'add_canvas_node',
          arguments: JSON.stringify({ label: 'Proposal' }),
        }],
      },
    })

    await vi.waitFor(() => expect(onToolCall).toHaveBeenCalledWith('add_canvas_node', { label: 'Proposal' }))
    await vi.waitFor(() => expect(peers[0].channel.sent.join('\n')).toContain('proposal-1'))
    const events = peers[0].channel.sent.map((event) => JSON.parse(event) as { type: string; item?: { output?: string } })
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'conversation.item.create' }),
      expect.objectContaining({ type: 'response.create' }),
      expect.objectContaining({ type: 'conversation.item.create', item: expect.objectContaining({ output: JSON.stringify({ ok: true, id: 'proposal-1' }) }) }),
    ]))
    expect(userTranscripts).toEqual(['Add an idea', 'Spoken design move'])
    expect(assistantTranscripts).toEqual(['I added it.'])
    expect(statuses).toContain('listening')
  })

  it('cancels an active response and releases the microphone when disconnected', async () => {
    installWebRtcFixture()
    const client = new RealtimeVoiceClient()

    await client.connect()
    client.interrupt()
    expect(peers[0].channel.sent.map((event) => JSON.parse(event))).toContainEqual({ type: 'response.cancel' })

    client.disconnect()
    expect(stopTrack).toHaveBeenCalled()
    expect(peers[0].connectionState).toBe('closed')
    expect(client.isConnected).toBe(false)
  })

  it('returns an honest structured error for an unknown tool call', async () => {
    installWebRtcFixture()
    const client = new RealtimeVoiceClient({ onToolCall: vi.fn() })
    await client.connect()
    peers[0].channel.receive({
      type: 'response.done',
      response: {
        output: [{ type: 'function_call', call_id: 'tool-unknown', name: 'not_a_tool', arguments: '{}' }],
      },
    })

    await vi.waitFor(() => expect(peers[0].channel.sent.join('\n')).toContain('UNKNOWN_TOOL'))
  })
})
