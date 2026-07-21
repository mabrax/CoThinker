import { expect, test, type Page } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('cothinker-e2e-initialized')) return
    window.localStorage.clear()
    window.sessionStorage.setItem('cothinker-e2e-initialized', 'true')
  })
})

test('shows an honest setup-required state while retaining the blank manual workspace', async ({ page }) => {
  await page.route('**/api/health', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, openaiConfigured: false }),
  }))

  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'CoThinker' })).toBeVisible()
  await expect(page.getByText('Setup required: set OPENAI_API_KEY on the server and restart it.')).toBeVisible()
  await expect(page.getByText('Connect OpenAI Realtime', { exact: true })).toBeDisabled()
  await expect(page.getByLabel('Message the connected collaborator')).toBeDisabled()
  await expect(page.getByTestId('canvas-board')).toHaveAttribute('data-canvas-ready', 'true')
  await expect(page.getByTestId('canvas-board')).toHaveAttribute('data-node-count', '0')
  await expect(page.getByTestId('promote-selection')).toBeDisabled()
})

test('runs the production Realtime client through transcripts, proposal, human promotion, interruption, and disconnect cleanup', async ({ page }) => {
  await installRealtimeFixture(page)
  await page.route('**/api/health', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, openaiConfigured: true }),
  }))
  await page.route('**/api/realtime/session', (route) => route.fulfill({
    status: 201,
    contentType: 'application/sdp',
    body: 'test-answer',
  }))

  await page.goto('/')
  await page.getByText('Connect OpenAI Realtime', { exact: true }).click()
  await expect(page.getByText('Live with OpenAI')).toBeVisible()

  await sendRealtimeEvent(page, {
    type: 'conversation.item.input_audio_transcription.completed',
    transcript: 'I want to explore durable notes.',
  })
  await sendRealtimeEvent(page, {
    type: 'response.output_audio_transcript.delta',
    item_id: 'assistant-turn',
    delta: 'Let us capture that as a proposal.',
  })
  await sendRealtimeEvent(page, {
    type: 'response.output_audio_transcript.done',
    item_id: 'assistant-turn',
  })
  await expect(page.getByTestId('transcript')).toContainText('I want to explore durable notes.')
  await expect(page.getByTestId('transcript')).toContainText('Let us capture that as a proposal.')

  await sendRealtimeEvent(page, {
    type: 'response.done',
    response: {
      output: [{
        type: 'function_call',
        call_id: 'canvas-proposal',
        name: 'add_canvas_node',
        arguments: JSON.stringify({ label: 'Durable notes' }),
      }],
    },
  })
  await expect(page.getByTestId('canvas-board')).toHaveAttribute('data-node-count', '1')
  await expect(page.getByTestId('canvas-board-debug')).toContainText('Durable notes')
  await expect(page.getByTestId('promote-selection')).toBeEnabled()
  await expect.poll(() => hasToolResult(page, 'canvas-proposal')).toBe(true)

  await sendRealtimeEvent(page, {
    type: 'response.done',
    response: {
      output: [{
        type: 'function_call',
        call_id: 'attempted-promotion',
        name: 'promote_to_document',
        arguments: JSON.stringify({ nodeIds: [] }),
      }],
    },
  })
  await expect.poll(() => hasToolResult(page, 'attempted-promotion')).toBe(true)
  await expect(page.getByTestId('document-sections')).toContainText('No accepted decisions yet.')
  await expect(page.getByTestId('transcript')).toContainText('requested promotion')

  await page.getByLabel('Section title').fill('Durable notes decision')
  await page.getByTestId('promote-selection').click()
  await expect(page.getByTestId('document-sections')).toContainText('Durable notes decision')

  await sendRealtimeEvent(page, { type: 'response.output_audio.delta' })
  await expect(page.getByText('Speaking…')).toBeVisible()
  await sendRealtimeEvent(page, { type: 'input_audio_buffer.speech_started' })
  await expect(page.getByText('Listening…')).toBeVisible()

  await page.getByText('Disconnect live AI', { exact: true }).click()
  await expect(page.getByText('Disconnected from OpenAI Realtime.')).toBeVisible()
  await expect.poll(() => page.evaluate(() => {
    const fixture = (window as unknown as { __testRealtime?: { tracksStopped: boolean } }).__testRealtime
    return fixture?.tracksStopped
  })).toBe(true)

  await page.reload()
  await expect(page.getByTestId('canvas-board')).toHaveAttribute('data-node-count', '1')
  await expect(page.getByTestId('document-sections')).toContainText('Durable notes decision')

  await page.getByRole('button', { name: 'New session' }).click()
  await expect(page.getByTestId('canvas-board')).toHaveAttribute('data-node-count', '0')
  await expect(page.getByTestId('document-sections')).toContainText('No accepted decisions yet.')
})

async function sendRealtimeEvent(page: Page, event: unknown): Promise<void> {
  await page.evaluate((payload) => {
    const fixture = (window as unknown as { __testRealtime?: { channel?: { receive(value: unknown): void } } }).__testRealtime
    fixture?.channel?.receive(payload)
  }, event)
}

async function hasToolResult(page: Page, callId: string): Promise<boolean | undefined> {
  return page.evaluate((id) => {
    const fixture = (window as unknown as { __testRealtime?: { sent: string[] } }).__testRealtime
    return fixture?.sent.some((event) => event.includes(id))
  }, callId)
}

async function installRealtimeFixture(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class TestChannel extends EventTarget {
      readyState = 'connecting'
      readonly sent: string[] = []

      send(payload: string): void { this.sent.push(payload) }

      open(): void {
        this.readyState = 'open'
        this.dispatchEvent(new Event('open'))
      }

      close(): void {
        if (this.readyState === 'closed') return
        this.readyState = 'closed'
        this.dispatchEvent(new Event('close'))
      }

      receive(value: unknown): void {
        this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) }))
      }
    }

    const fixture: { channel?: TestChannel; sent: string[]; tracksStopped: boolean } = { sent: [], tracksStopped: false }
    class TestPeerConnection extends EventTarget {
      connectionState = 'connected'
      localDescription: RTCSessionDescriptionInit | null = null
      readonly channel = new TestChannel()

      constructor() {
        super()
        fixture.channel = this.channel
        fixture.sent = this.channel.sent
      }

      addTrack(): void {}
      createDataChannel(): RTCDataChannel { return this.channel as unknown as RTCDataChannel }
      async createOffer(): Promise<RTCSessionDescriptionInit> { return { type: 'offer', sdp: 'test-offer' } }
      async setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> { this.localDescription = description }
      async setRemoteDescription(): Promise<void> { this.channel.open() }
      getSenders(): RTCRtpSender[] { return [] }
      close(): void { this.connectionState = 'closed' }
    }

    Object.defineProperty(window, 'RTCPeerConnection', { configurable: true, value: TestPeerConnection })
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => ({
          getTracks: () => [{ stop: () => { fixture.tracksStopped = true } }],
          getAudioTracks: () => [{ stop: () => { fixture.tracksStopped = true } }],
        }),
      },
    })
    ;(window as unknown as { __testRealtime: typeof fixture }).__testRealtime = fixture
  })
}
