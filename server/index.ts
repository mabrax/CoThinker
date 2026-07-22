import express from 'express'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  OPENAI_BASE_URL,
  OPENAI_MODELS,
  OPENAI_TIMEOUTS_MS,
  REASONING_INSTRUCTIONS,
  openAIApiKey,
  realtimeSession,
} from './openai.js'

const app = express()

app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    openaiConfigured: Boolean(openAIApiKey()),
  })
})

app.post(
  '/api/realtime/session',
  express.text({ type: ['application/sdp', 'text/plain'], limit: '1mb' }),
  async (request, response) => {
    const apiKey = openAIApiKey()
    if (!apiKey) {
      response.status(503).json({
        error: 'Voice is not configured yet. Add OPENAI_API_KEY to the server environment and restart it.',
      })
      return
    }

    if (typeof request.body !== 'string' || !request.body.trim()) {
      response.status(400).json({ error: 'A WebRTC SDP offer is required.' })
      return
    }

    const form = new FormData()
    form.set('sdp', request.body)
    form.set('session', JSON.stringify(realtimeSession))

    try {
      const signal = AbortSignal.timeout(OPENAI_TIMEOUTS_MS.realtimeSession)
      const upstream = await fetch(`${OPENAI_BASE_URL}/realtime/calls`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal,
      })
      const payload = await upstream.text()

      if (!upstream.ok) {
        response.status(upstream.status).json({
          error: extractOpenAIError(payload, 'OpenAI could not start the voice session.'),
        })
        return
      }

      response.status(201).type('application/sdp').send(payload)
    } catch (error) {
      console.error('Realtime session error:', error)
      if (isTimeoutError(error)) {
        response.status(504).json({
          error: 'OpenAI timed out while starting the voice session.',
        })
        return
      }
      response.status(502).json({
        error: 'The voice service could not be reached. Check the server connection and try again.',
      })
    }
  },
)

app.use(express.json({ limit: '2mb' }))

app.post('/api/reason', async (request, response) => {
  const apiKey = openAIApiKey()
  if (!apiKey) {
    response.status(503).json({
      error: 'Deep reasoning is not configured yet. Add OPENAI_API_KEY to the server environment and restart it.',
    })
    return
  }

  const input = reasoningInput(request.body)
  if (input === undefined) {
    response.status(400).json({ error: 'A reasoning prompt is required.' })
    return
  }

  try {
    const signal = AbortSignal.timeout(OPENAI_TIMEOUTS_MS.reasoning)
    const upstream = await fetch(`${OPENAI_BASE_URL}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_MODELS.reasoning,
        reasoning: { effort: 'medium' },
        instructions: REASONING_INSTRUCTIONS,
        input,
      }),
      signal,
    })
    const payload = await readJsonPayload(upstream)

    if (!upstream.ok) {
      response.status(upstream.status).json({
        error: extractResponseError(payload, 'OpenAI could not complete the reasoning request.'),
      })
      return
    }

    const text = responseText(payload)
    if (!text) {
      response.status(502).json({ error: 'The reasoning request completed without a text answer.' })
      return
    }

    response.json({ text })
  } catch (error) {
    console.error('Reasoning request error:', error)
    if (isTimeoutError(error)) {
      response.status(504).json({
        error: 'OpenAI timed out while completing the reasoning request.',
      })
      return
    }
    response.status(502).json({
      error: 'The reasoning service could not be reached. Check the server connection and try again.',
    })
  }
})

serveProductionBuild(app)

function reasoningInput(body: unknown): unknown | undefined {
  if (typeof body === 'string' && body.trim()) return body.trim()
  if (!isRecord(body)) return undefined

  if (body.input !== undefined) {
    if (typeof body.input === 'string') return body.input.trim() || undefined
    return body.input
  }

  const prompt = [body.prompt, body.question].find(
    (value): value is string => typeof value === 'string' && Boolean(value.trim()),
  )
  if (!prompt) return undefined

  const contextValue = body.context ?? body.canvas
  if (contextValue === undefined) return prompt.trim()
  const context =
    typeof contextValue === 'string' ? contextValue : JSON.stringify(contextValue, null, 2)
  return `${prompt.trim()}\n\nContext:\n${context}`
}

function responseText(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim()
  }
  if (!Array.isArray(payload.output)) return undefined

  const parts: string[] = []
  for (const item of payload.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue
    for (const content of item.content) {
      if (isRecord(content) && content.type === 'output_text' && typeof content.text === 'string') {
        parts.push(content.text)
      }
    }
  }
  return parts.join('\n').trim() || undefined
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === 'TimeoutError'
}

async function readJsonPayload(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch (error) {
    if (error instanceof SyntaxError) return undefined
    throw error
  }
}

const MAX_UPSTREAM_ERROR_LENGTH = 512

function sanitizeUpstreamMessage(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const message = value.trim()
  return message ? message.slice(0, MAX_UPSTREAM_ERROR_LENGTH) : undefined
}

function extractOpenAIError(payload: string, fallback: string): string {
  try {
    return extractResponseError(JSON.parse(payload), fallback)
  } catch {
    return fallback
  }
}

function extractResponseError(payload: unknown, fallback: string): string {
  if (!isRecord(payload)) return fallback
  const message = sanitizeUpstreamMessage(payload.message)
  if (message) return message
  const nestedMessage = isRecord(payload.error)
    ? sanitizeUpstreamMessage(payload.error.message)
    : undefined
  if (nestedMessage) return nestedMessage
  return fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function serveProductionBuild(expressApp: express.Express): void {
  if (process.env.NODE_ENV !== 'production') return

  const serverDirectory = path.dirname(fileURLToPath(import.meta.url))
  const distDirectory = [path.resolve(process.cwd(), 'dist'), path.resolve(serverDirectory, '../dist')].find(
    (candidate) => existsSync(path.join(candidate, 'index.html')),
  )
  if (!distDirectory) return

  expressApp.use(express.static(distDirectory))
  expressApp.use((request, response, next) => {
    if (request.method !== 'GET' || request.path.startsWith('/api/')) {
      next()
      return
    }
    response.sendFile(path.join(distDirectory, 'index.html'))
  })
}

function startServer() {
  const requestedPort = Number(process.env.PORT ?? 3001)
  const port = Number.isFinite(requestedPort) ? requestedPort : 3001
  return app.listen(port, () => {
    console.log(`CoThinker server listening on http://localhost:${port}`)
  })
}

export { app, realtimeSession, startServer }
export default app
