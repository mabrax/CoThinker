import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { app } from './index.js'

const realFetch = globalThis.fetch
const originalApiKey = process.env.OPENAI_API_KEY
let server: Server | undefined

async function startTestServer(): Promise<string> {
  const listeningServer = app.listen(0, '127.0.0.1')
  server = listeningServer
  await new Promise<void>((resolve, reject) => {
    listeningServer.once('listening', resolve)
    listeningServer.once('error', reject)
  })
  const address = listeningServer.address() as AddressInfo
  return `http://127.0.0.1:${address.port}`
}

afterEach(async () => {
  globalThis.fetch = realFetch
  if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY
  else process.env.OPENAI_API_KEY = originalApiKey
  vi.restoreAllMocks()
  if (server) {
    await new Promise<void>((resolve, reject) =>
      server?.close((error) => (error ? reject(error) : resolve())),
    )
    server = undefined
  }
})

describe('OpenAI server boundaries', () => {
  it('reports unavailable services without credentials and never contacts OpenAI', async () => {
    delete process.env.OPENAI_API_KEY
    const upstreamFetch = vi.fn()
    globalThis.fetch = upstreamFetch as typeof fetch
    const baseUrl = await startTestServer()

    const healthResponse = await realFetch(`${baseUrl}/api/health`)
    expect(healthResponse.status).toBe(200)
    await expect(healthResponse.json()).resolves.toEqual({
      ok: true,
      openaiConfigured: false,
    })

    const realtimeResponse = await realFetch(`${baseUrl}/api/realtime/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp' },
      body: 'v=0\r\no=browser-offer',
    })
    expect(realtimeResponse.status).toBe(503)
    await expect(realtimeResponse.json()).resolves.toMatchObject({
      error: expect.stringContaining('OPENAI_API_KEY'),
    })

    const reasoningResponse = await realFetch(`${baseUrl}/api/reason`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Compare the two candidate designs.' }),
    })
    expect(reasoningResponse.status).toBe(503)
    await expect(reasoningResponse.json()).resolves.toMatchObject({
      error: expect.stringContaining('OPENAI_API_KEY'),
    })
    expect(upstreamFetch).not.toHaveBeenCalled()
  })

  it('relays the official plain-field Realtime form and a reasoning response', async () => {
    process.env.OPENAI_API_KEY = 'test-server-key'
    const upstreamFetch = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input)
        if (url.endsWith('/realtime/calls')) {
          return new Response('v=0\r\no=openai-answer', {
            status: 201,
            headers: { 'Content-Type': 'application/sdp' },
          })
        }
        if (url.endsWith('/responses')) {
          return Response.json({ output_text: 'Keep the voice loop responsive.' })
        }
        throw new Error(`Unexpected upstream request: ${url} ${init?.method}`)
      },
    )
    globalThis.fetch = upstreamFetch as typeof fetch

    const baseUrl = await startTestServer()

    const realtimeResponse = await realFetch(`${baseUrl}/api/realtime/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp' },
      body: 'v=0\r\no=browser-offer',
    })
    expect(realtimeResponse.status).toBe(201)
    expect(await realtimeResponse.text()).toContain('openai-answer')

    const realtimeCall = upstreamFetch.mock.calls.find(([input]) =>
      String(input).endsWith('/realtime/calls'),
    )
    expect(realtimeCall).toBeDefined()
    const realtimeForm = realtimeCall?.[1]?.body
    expect(realtimeForm).toBeInstanceOf(FormData)
    expect((realtimeForm as FormData).get('sdp')).toBe('v=0\r\no=browser-offer')
    expect(
      JSON.parse(String((realtimeForm as FormData).get('session'))),
    ).toMatchObject({ model: 'gpt-realtime-2.1', type: 'realtime' })

    const reasoningResponse = await realFetch(`${baseUrl}/api/reason`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'How should delegation work?' }),
    })
    expect(reasoningResponse.status).toBe(200)
    await expect(reasoningResponse.json()).resolves.toEqual({
      text: 'Keep the voice loop responsive.',
    })

    const reasoningCall = upstreamFetch.mock.calls.find(([input]) =>
      String(input).endsWith('/responses'),
    )
    expect(reasoningCall?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer test-server-key',
      'Content-Type': 'application/json',
    })
  })
})
