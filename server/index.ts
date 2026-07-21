import express from 'express'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const OPENAI_BASE_URL = 'https://api.openai.com/v1'

const realtimeTools = [
  {
    type: 'function',
    name: 'get_canvas_state',
    description: 'Read the current canvas nodes, connections, and selected items.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'add_canvas_node',
    description: 'Add one useful idea, note, question, or decision to the canvas.',
    parameters: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'Short text shown on the node.' },
        kind: { type: 'string', description: 'Optional node category.' },
        details: { type: 'string', description: 'Optional supporting detail.' },
        x: { type: 'number', description: 'Optional horizontal canvas position.' },
        y: { type: 'number', description: 'Optional vertical canvas position.' },
      },
      required: ['label'],
      additionalProperties: true,
    },
  },
  {
    type: 'function',
    name: 'connect_canvas_nodes',
    description: 'Create a meaningful connection between two existing canvas nodes.',
    parameters: {
      type: 'object',
      properties: {
        sourceId: { type: 'string', description: 'ID of the source node.' },
        targetId: { type: 'string', description: 'ID of the target node.' },
        label: { type: 'string', description: 'Optional relationship label.' },
      },
      required: ['sourceId', 'targetId'],
      additionalProperties: true,
    },
  },
  {
    type: 'function',
    name: 'promote_to_document',
    description: 'Turn selected canvas ideas into a more durable document artifact.',
    parameters: {
      type: 'object',
      properties: {
        nodeIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Canvas node IDs to promote.',
        },
        title: { type: 'string', description: 'Optional document title.' },
      },
      required: ['nodeIds'],
      additionalProperties: true,
    },
  },
  {
    type: 'function',
    name: 'delegate_reasoning',
    description: 'Ask a deeper reasoning model for help with a difficult synthesis or decision.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The focused reasoning question.' },
        context: { type: 'string', description: 'Optional concise context from the canvas.' },
      },
      required: ['prompt'],
      additionalProperties: true,
    },
  },
]

const realtimeSession = {
  type: 'realtime',
  model: 'gpt-realtime-2.1',
  output_modalities: ['audio'],
  instructions: [
    'Be a concise co-thinking partner for a visual idea canvas.',
    'Help the user clarify, connect, and externalize their thinking; do not take over the thinking.',
    'Speak in short, natural turns and ask at most one useful question at a time.',
    'Use canvas tools when an action or current state is needed, and never claim an action succeeded before its tool result.',
    'Use delegate_reasoning only when deeper analysis would materially help.',
  ].join(' '),
  audio: {
    input: {
      transcription: { model: 'gpt-4o-mini-transcribe' },
      turn_detection: {
        type: 'semantic_vad',
        eagerness: 'auto',
        create_response: true,
        interrupt_response: true,
      },
    },
    output: { voice: 'marin' },
  },
  tools: realtimeTools,
  tool_choice: 'auto',
}

const app = express()

app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY?.trim()),
  })
})

app.post(
  '/api/realtime/session',
  express.text({ type: ['application/sdp', 'text/plain'], limit: '1mb' }),
  async (request, response) => {
    const apiKey = process.env.OPENAI_API_KEY?.trim()
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
      const upstream = await fetch(`${OPENAI_BASE_URL}/realtime/calls`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
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
      response.status(502).json({
        error: 'The voice service could not be reached. Check the server connection and try again.',
      })
    }
  },
)

app.use(express.json({ limit: '2mb' }))

app.post('/api/reason', async (request, response) => {
  const apiKey = process.env.OPENAI_API_KEY?.trim()
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
    const upstream = await fetch(`${OPENAI_BASE_URL}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-5.6-sol',
        reasoning: { effort: 'medium' },
        instructions: 'Reason carefully, then return a concise, useful synthesis for a co-thinking canvas.',
        input,
      }),
    })
    const payload: unknown = await upstream.json().catch(() => undefined)

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

function extractOpenAIError(payload: string, fallback: string): string {
  try {
    return extractResponseError(JSON.parse(payload), fallback)
  } catch {
    return payload.trim() || fallback
  }
}

function extractResponseError(payload: unknown, fallback: string): string {
  if (!isRecord(payload)) return fallback
  if (typeof payload.message === 'string') return payload.message
  if (isRecord(payload.error) && typeof payload.error.message === 'string') {
    return payload.error.message
  }
  return fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
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
    console.log(`Jarvis server listening on http://localhost:${port}`)
  })
}

export { app, realtimeSession, startServer }
export default app
