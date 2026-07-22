import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { app } from './index.js'

const realFetch = globalThis.fetch
const originalApiKey = process.env.OPENAI_API_KEY
let server: Server | undefined

type OpenAIRoute = 'realtime' | 'reasoning'

const routeErrors = {
  realtime: {
    timeout: 'OpenAI timed out while starting the voice session.',
    transport:
      'The voice service could not be reached. Check the server connection and try again.',
    upstream: 'OpenAI could not start the voice session.',
  },
  reasoning: {
    timeout: 'OpenAI timed out while completing the reasoning request.',
    transport:
      'The reasoning service could not be reached. Check the server connection and try again.',
    upstream: 'OpenAI could not complete the reasoning request.',
  },
} as const

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

function requestRealtime(baseUrl: string): Promise<Response> {
  return realFetch(`${baseUrl}/api/realtime/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sdp' },
    body: 'v=0\r\no=browser-offer',
  })
}

function requestReasoning(baseUrl: string): Promise<Response> {
  return realFetch(`${baseUrl}/api/reason`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'How should delegation work?' }),
  })
}

function requestRoute(route: OpenAIRoute, baseUrl: string): Promise<Response> {
  return route === 'realtime' ? requestRealtime(baseUrl) : requestReasoning(baseUrl)
}

function responseWithBodyFailure(route: OpenAIRoute, error: unknown): Response {
  if (route === 'realtime') {
    return {
      ok: true,
      status: 201,
      text: vi.fn().mockRejectedValue(error),
    } as unknown as Response
  }

  return {
    ok: true,
    status: 200,
    json: vi.fn().mockRejectedValue(error),
  } as unknown as Response
}

function errorResponse(payload: unknown, status = 429): Response {
  const body = JSON.stringify(payload)
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
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

    const realtimeResponse = await requestRealtime(baseUrl)
    expect(realtimeResponse.status).toBe(503)
    await expect(realtimeResponse.json()).resolves.toMatchObject({
      error: expect.stringContaining('OPENAI_API_KEY'),
    })

    const reasoningResponse = await requestReasoning(baseUrl)
    expect(reasoningResponse.status).toBe(503)
    await expect(reasoningResponse.json()).resolves.toMatchObject({
      error: expect.stringContaining('OPENAI_API_KEY'),
    })
    expect(upstreamFetch).not.toHaveBeenCalled()
  })

  it('uses fresh route-specific signals while preserving successful responses', async () => {
    process.env.OPENAI_API_KEY = 'test-server-key'
    const signals = Array.from({ length: 4 }, () => new AbortController().signal)
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout')
    for (const signal of signals) timeoutSpy.mockReturnValueOnce(signal)

    const upstreamFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
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
    })
    globalThis.fetch = upstreamFetch as typeof fetch

    const baseUrl = await startTestServer()

    for (let request = 0; request < 2; request += 1) {
      const realtimeResponse = await requestRealtime(baseUrl)
      expect(realtimeResponse.status).toBe(201)
      expect(await realtimeResponse.text()).toContain('openai-answer')
    }

    for (let request = 0; request < 2; request += 1) {
      const reasoningResponse = await requestReasoning(baseUrl)
      expect(reasoningResponse.status).toBe(200)
      await expect(reasoningResponse.json()).resolves.toEqual({
        text: 'Keep the voice loop responsive.',
      })
    }

    expect(timeoutSpy.mock.calls).toEqual([[30_000], [30_000], [120_000], [120_000]])

    const realtimeCalls = upstreamFetch.mock.calls.filter(([input]) =>
      String(input).endsWith('/realtime/calls'),
    )
    expect(realtimeCalls).toHaveLength(2)
    expect(realtimeCalls[0]?.[1]?.signal).toBe(signals[0])
    expect(realtimeCalls[1]?.[1]?.signal).toBe(signals[1])
    expect(realtimeCalls[0]?.[1]?.signal).not.toBe(realtimeCalls[1]?.[1]?.signal)

    const realtimeForm = realtimeCalls[0]?.[1]?.body
    expect(realtimeForm).toBeInstanceOf(FormData)
    expect((realtimeForm as FormData).get('sdp')).toBe('v=0\r\no=browser-offer')
    expect(JSON.parse(String((realtimeForm as FormData).get('session')))).toMatchObject({
      model: 'gpt-realtime-2.1',
      type: 'realtime',
    })

    const reasoningCalls = upstreamFetch.mock.calls.filter(([input]) =>
      String(input).endsWith('/responses'),
    )
    expect(reasoningCalls).toHaveLength(2)
    expect(reasoningCalls[0]?.[1]?.signal).toBe(signals[2])
    expect(reasoningCalls[1]?.[1]?.signal).toBe(signals[3])
    expect(reasoningCalls[0]?.[1]?.signal).not.toBe(reasoningCalls[1]?.[1]?.signal)
    expect(reasoningCalls[0]?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer test-server-key',
      'Content-Type': 'application/json',
    })
  })

  it.each([
    { route: 'realtime' as const, failurePoint: 'fetch' as const },
    { route: 'realtime' as const, failurePoint: 'body' as const },
    { route: 'reasoning' as const, failurePoint: 'fetch' as const },
    { route: 'reasoning' as const, failurePoint: 'body' as const },
  ])('maps a $route $failurePoint timeout to its 504 response', async ({ route, failurePoint }) => {
    process.env.OPENAI_API_KEY = 'test-server-key'
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const error = new DOMException('The operation timed out.', 'TimeoutError')
    const upstreamFetch =
      failurePoint === 'fetch'
        ? vi.fn().mockRejectedValue(error)
        : vi.fn().mockResolvedValue(responseWithBodyFailure(route, error))
    globalThis.fetch = upstreamFetch as typeof fetch
    const baseUrl = await startTestServer()

    const response = await requestRoute(route, baseUrl)

    expect(response.status).toBe(504)
    await expect(response.json()).resolves.toEqual({ error: routeErrors[route].timeout })
  })

  it.each([
    { route: 'realtime' as const, failurePoint: 'fetch' as const },
    { route: 'realtime' as const, failurePoint: 'body' as const },
    { route: 'reasoning' as const, failurePoint: 'fetch' as const },
    { route: 'reasoning' as const, failurePoint: 'body' as const },
  ])(
    'keeps a non-timeout $route $failurePoint failure on its 502 response',
    async ({ route, failurePoint }) => {
      process.env.OPENAI_API_KEY = 'test-server-key'
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const error = new Error('provider transport failed')
      const upstreamFetch =
        failurePoint === 'fetch'
          ? vi.fn().mockRejectedValue(error)
          : vi.fn().mockResolvedValue(responseWithBodyFailure(route, error))
      globalThis.fetch = upstreamFetch as typeof fetch
      const baseUrl = await startTestServer()

      const response = await requestRoute(route, baseUrl)

      expect(response.status).toBe(502)
      await expect(response.json()).resolves.toEqual({ error: routeErrors[route].transport })
    },
  )

  it('does not classify a non-Error value named TimeoutError as a timeout', async () => {
    process.env.OPENAI_API_KEY = 'test-server-key'
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    globalThis.fetch = vi.fn().mockRejectedValue({ name: 'TimeoutError' }) as typeof fetch
    const baseUrl = await startTestServer()

    const response = await requestRealtime(baseUrl)

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: routeErrors.realtime.transport })
  })

  it.each([
    {
      name: 'top-level message before nested message',
      payload: { message: ' top-level ', error: { message: 'nested' } },
      expected: 'top-level',
    },
    {
      name: 'nested message when top-level is blank',
      payload: { message: ' \n ', error: { message: ' nested ' } },
      expected: 'nested',
    },
    {
      name: 'trimmed recognized message',
      payload: { message: '\t provider detail \n' },
      expected: 'provider detail',
    },
    {
      name: 'blank recognized messages',
      payload: { message: ' ', error: { message: '\n' } },
      expected: undefined,
    },
    {
      name: 'exactly 512 code units',
      payload: { message: 'x'.repeat(512) },
      expected: 'x'.repeat(512),
    },
    {
      name: 'more than 512 code units',
      payload: { message: 'y'.repeat(513) },
      expected: 'y'.repeat(512),
    },
    {
      name: 'an unrecognized object',
      payload: { detail: 'must not cross the proxy' },
      expected: undefined,
    },
    {
      name: 'a JSON scalar',
      payload: 'must not cross the proxy',
      expected: undefined,
    },
    {
      name: 'a JSON array',
      payload: [{ message: 'must not cross the proxy' }],
      expected: undefined,
    },
  ])('sanitizes $name for both upstream adapters', async ({ payload, expected }) => {
    process.env.OPENAI_API_KEY = 'test-server-key'
    const baseUrl = await startTestServer()

    for (const route of ['realtime', 'reasoning'] as const) {
      globalThis.fetch = vi.fn().mockResolvedValue(errorResponse(payload)) as typeof fetch

      const response = await requestRoute(route, baseUrl)

      expect(response.status).toBe(429)
      await expect(response.json()).resolves.toEqual({
        error: expected ?? routeErrors[route].upstream,
      })
    }
  })

  it('uses the Realtime fallback for a non-JSON upstream error body', async () => {
    process.env.OPENAI_API_KEY = 'test-server-key'
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response('raw provider detail', { status: 429 })) as typeof fetch
    const baseUrl = await startTestServer()

    const response = await requestRealtime(baseUrl)

    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toEqual({ error: routeErrors.realtime.upstream })
  })

  it.each([
    {
      status: 429,
      expected: 'OpenAI could not complete the reasoning request.',
    },
    {
      status: 200,
      expected: 'The reasoning request completed without a text answer.',
    },
  ])(
    'treats malformed reasoning JSON at status $status as a syntax failure, not transport failure',
    async ({ status, expected }) => {
      process.env.OPENAI_API_KEY = 'test-server-key'
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('{', { status })) as typeof fetch
      const baseUrl = await startTestServer()

      const response = await requestReasoning(baseUrl)

      expect(response.status).toBe(status === 200 ? 502 : status)
      await expect(response.json()).resolves.toEqual({ error: expected })
    },
  )

  it('keeps valid successful reasoning JSON without usable output on the no-text response', async () => {
    process.env.OPENAI_API_KEY = 'test-server-key'
    globalThis.fetch = vi.fn().mockResolvedValue(Response.json({ output: [] })) as typeof fetch
    const baseUrl = await startTestServer()

    const response = await requestReasoning(baseUrl)

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({
      error: 'The reasoning request completed without a text answer.',
    })
  })
})
