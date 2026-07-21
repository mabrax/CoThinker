import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CanvasBoard,
  type CanvasBoardHandle,
} from './components/CanvasBoard'
import type { CanvasNodeKind } from './canvas'
import { RealtimeVoiceClient } from './realtime'
import {
  buildMarkdown,
  makeId,
  nowIso,
  type ActivityEvent,
  type DesignSection,
  type PersistedWorkspace,
  type Speaker,
  type TranscriptEntry,
} from './domain'
import { useBrowserVoice } from './hooks/useBrowserVoice'
import {
  runLocalCollaborator,
  type LocalCanvasPort,
  type SceneEntity,
} from './localCollaborator'
import './App.css'

interface SceneSummaryLike {
  [key: string]: unknown
  elements: Array<
    SceneEntity & {
      x?: number
      y?: number
      origin?: string
      text?: string
      customData?: Record<string, unknown>
    }
  >
  selectedElementIds?: string[]
  elementCount?: number
  aiElementCount?: number
}

interface HealthState {
  loading: boolean
  apiConfigured: boolean
  message: string
}

declare global {
  interface Window {
    __cothinker?: {
      runDemo: () => Promise<void>
      sendText: (text: string) => Promise<void>
      getState: () => {
        scene: SceneSummaryLike
        sections: DesignSection[]
        transcript: TranscriptEntry[]
      }
    }
  }
}

const STORAGE_KEY = 'cothinker-workspace-v1'

const readPersistedWorkspace = (): PersistedWorkspace => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { sections: [], transcript: [] }
    const parsed = JSON.parse(raw) as Partial<PersistedWorkspace>
    return {
      sections: Array.isArray(parsed.sections) ? parsed.sections : [],
      transcript: Array.isArray(parsed.transcript) ? parsed.transcript : [],
    }
  } catch {
    return { sections: [], transcript: [] }
  }
}

const labelForElement = (element: SceneSummaryLike['elements'][number]) =>
  element.label || element.text || element.type || 'canvas element'

function App() {
  const persisted = useMemo(readPersistedWorkspace, [])
  const canvasRef = useRef<CanvasBoardHandle>(null)
  const realtimeRef = useRef<RealtimeVoiceClient | null>(null)
  const speakRef = useRef<(text: string) => boolean>(() => false)

  const [health, setHealth] = useState<HealthState>({
    loading: true,
    apiConfigured: false,
    message: 'Checking realtime availability…',
  })
  const [voiceStatus, setVoiceStatus] = useState('Ready in local mode')
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [typedInput, setTypedInput] = useState('')
  const [interimText, setInterimText] = useState('')
  const [transcript, setTranscript] = useState<TranscriptEntry[]>(
    persisted.transcript,
  )
  const [sections, setSections] = useState<DesignSection[]>(persisted.sections)
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [scene, setScene] = useState<SceneSummaryLike>({ elements: [] })
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [documentTitle, setDocumentTitle] = useState('Accepted design direction')
  const [busy, setBusy] = useState(false)

  const addTranscript = useCallback((speaker: Speaker, text: string) => {
    const cleaned = text.trim()
    if (!cleaned) return
    setTranscript((current) => [
      ...current.slice(-79),
      { id: makeId('line'), speaker, text: cleaned, createdAt: nowIso() },
    ])
  }, [])

  const addEvent = useCallback((label: string, detail: string) => {
    setEvents((current) => [
      { id: makeId('event'), label, detail, createdAt: nowIso() },
      ...current,
    ].slice(0, 12))
  }, [])

  const getScene = useCallback((): SceneSummaryLike => {
    const summary = canvasRef.current?.getSceneSummary()
    return (summary ?? scene) as unknown as SceneSummaryLike
  }, [scene])

  const promoteElements = useCallback(
    (
      elementIds: string[],
      title = documentTitle,
      suppliedBody?: string,
      source: DesignSection['source'] = 'human',
    ) => {
      const currentScene = getScene()
      const ids = elementIds.length > 0 ? elementIds : selectedIds
      if (ids.length === 0) {
        addTranscript('system', 'Select one or more canvas elements before promoting.')
        return { ok: false, reason: 'No canvas elements selected.' }
      }

      const selected = currentScene.elements.filter((element) =>
        ids.includes(element.id),
      )
      const body =
        suppliedBody?.trim() ||
        [
          'Accepted from the shared canvas:',
          '',
          ...selected.map((element) => `- ${labelForElement(element)}`),
        ].join('\n')

      const section: DesignSection = {
        id: makeId('section'),
        title: title.trim() || 'Accepted design direction',
        body,
        elementIds: ids,
        createdAt: nowIso(),
        source,
      }
      setSections((current) => [...current, section])
      addEvent('Promoted to document', `${section.title} · ${ids.length} source elements`)
      return { ok: true, sectionId: section.id, elementIds: ids }
    },
    [addEvent, addTranscript, documentTitle, getScene, selectedIds],
  )

  const canvasPort = useCallback((): LocalCanvasPort => ({
    getScene,
    addNode: async (input) => {
      const id = await Promise.resolve(
        canvasRef.current?.addNode({
          ...input,
          kind: input.kind as CanvasNodeKind | undefined,
        }),
      )
      if (!id) throw new Error('Canvas is not ready yet.')
      addEvent('AI canvas proposal', input.label)
      return id
    },
    connectNodes: async (input) => {
      const id = await Promise.resolve(canvasRef.current?.connectNodes(input))
      if (id) addEvent('AI canvas connection', `${input.fromId} → ${input.toId}`)
      return id ?? null
    },
    promote: ({ title, body, elementIds }) => {
      promoteElements(elementIds, title, body, 'ai')
    },
  }), [addEvent, getScene, promoteElements])

  const handleToolCall = useCallback(
    async (name: string, rawArgs: Record<string, unknown>) => {
      const args = rawArgs ?? {}
      if (name === 'get_canvas_state') return getScene()

      if (name === 'add_canvas_node') {
        const label = String(args.label || args.details || 'AI proposal')
        const id = await Promise.resolve(
          canvasRef.current?.addNode({
            label,
            kind: (typeof args.kind === 'string' ? args.kind : 'rectangle') as CanvasNodeKind,
            x: typeof args.x === 'number' ? args.x : undefined,
            y: typeof args.y === 'number' ? args.y : undefined,
            origin: 'ai',
          }),
        )
        addEvent('Realtime canvas tool', `Added ${label}`)
        return { ok: Boolean(id), id }
      }

      if (name === 'connect_canvas_nodes') {
        const fromId = String(args.fromId || args.sourceId || '')
        const toId = String(args.toId || args.targetId || '')
        const id = await Promise.resolve(
          canvasRef.current?.connectNodes({
            fromId,
            toId,
            label: typeof args.label === 'string' ? args.label : undefined,
            origin: 'ai',
          }),
        )
        addEvent('Realtime canvas tool', `Connected ${fromId} → ${toId}`)
        return { ok: Boolean(id), id }
      }

      if (name === 'promote_to_document') {
        const ids = Array.isArray(args.elementIds)
          ? args.elementIds.map(String)
          : Array.isArray(args.nodeIds)
            ? args.nodeIds.map(String)
            : selectedIds
        return promoteElements(
          ids,
          typeof args.title === 'string' ? args.title : documentTitle,
          typeof args.summary === 'string' ? args.summary : undefined,
          'ai',
        )
      }

      if (name === 'delegate_reasoning') {
        const prompt = String(args.prompt || 'Analyze the current canvas and propose the next useful design move.')
        const response = await fetch('/api/reason', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, canvas: getScene(), context: args.context }),
        })
        if (!response.ok) {
          return {
            ok: false,
            fallback:
              'Keep the realtime interaction loop separate from deeper reasoning, and coordinate them through explicit shared session state.',
          }
        }
        return response.json()
      }

      return { ok: false, error: `Unknown tool: ${name}` }
    },
    [addEvent, documentTitle, getScene, promoteElements, selectedIds],
  )

  const handleLocalTranscript = useCallback(
    async (text: string) => {
      addTranscript('human', text)
      setInterimText('')
      setBusy(true)
      try {
        const result = await runLocalCollaborator(text, canvasPort())
        addTranscript('voice', result.reply)
        speakRef.current(result.reply)
      } catch (error) {
        addTranscript(
          'system',
          error instanceof Error ? error.message : 'The local collaborator could not apply that move.',
        )
      } finally {
        setBusy(false)
      }
    },
    [addTranscript, canvasPort],
  )

  const browserVoice = useBrowserVoice({
    onFinalTranscript: handleLocalTranscript,
    onInterimTranscript: setInterimText,
  })
  const stopBrowserVoice = browserVoice.stop
  speakRef.current = browserVoice.speak

  const resetWorkspace = useCallback(() => {
    stopBrowserVoice()
    realtimeRef.current?.disconnect()
    realtimeRef.current = null
    canvasRef.current?.reset()
    setTranscript([])
    setSections([])
    setEvents([])
    setSelectedIds([])
    setTypedInput('')
    setInterimText('')
    setDocumentTitle('Accepted design direction')
    setIsRealtimeConnected(false)
    setVoiceStatus('Ready in local mode')
    window.localStorage.removeItem(STORAGE_KEY)
  }, [stopBrowserVoice])

  const submitText = useCallback(
    async (text: string) => {
      const cleaned = text.trim()
      if (!cleaned) return
      setTypedInput('')
      if (realtimeRef.current?.isConnected) {
        realtimeRef.current.sendText(cleaned)
        return
      }
      await handleLocalTranscript(cleaned)
    },
    [handleLocalTranscript],
  )

  const connectRealtime = useCallback(async () => {
    if (realtimeRef.current?.isConnected) {
      realtimeRef.current.disconnect()
      realtimeRef.current = null
      setIsRealtimeConnected(false)
      setVoiceStatus('Ready in local mode')
      return
    }

    setIsConnecting(true)
    const client = new RealtimeVoiceClient({
      onStatus: (status, message) => {
        setVoiceStatus(message || status)
        setIsRealtimeConnected(
          status !== 'idle' && status !== 'error' && status !== 'connecting',
        )
      },
      onUserTranscript: (text) => addTranscript('human', text),
      onAssistantTranscript: (text) => addTranscript('voice', text),
      onToolCall: handleToolCall,
    })
    realtimeRef.current = client
    try {
      await client.connect()
    } catch (error) {
      setIsRealtimeConnected(false)
      setVoiceStatus(error instanceof Error ? error.message : 'Realtime connection failed')
      realtimeRef.current = null
    } finally {
      setIsConnecting(false)
    }
  }, [addTranscript, handleToolCall])

  const runDemo = useCallback(async () => {
    if (!canvasRef.current || busy) return
    setBusy(true)
    try {
      canvasRef.current.reset()
      addTranscript('human', 'Let us design a system where voice stays natural while deeper reasoning runs in the background.')
      await new Promise((resolve) => window.setTimeout(resolve, 250))
      const human = await Promise.resolve(
        canvasRef.current.addNode({ label: 'Human collaborator', x: 80, y: 260, kind: 'ellipse', origin: 'human' }),
      )
      const voice = await Promise.resolve(
        canvasRef.current.addNode({ label: 'Realtime voice agent', x: 360, y: 90, kind: 'process', origin: 'ai' }),
      )
      const state = await Promise.resolve(
        canvasRef.current.addNode({ label: 'Shared session state', x: 390, y: 300, kind: 'decision', origin: 'ai' }),
      )
      const reasoning = await Promise.resolve(
        canvasRef.current.addNode({ label: 'Reasoning delegate', x: 710, y: 90, kind: 'process', origin: 'ai' }),
      )
      const documentNode = await Promise.resolve(
        canvasRef.current.addNode({ label: 'Durable design document', x: 720, y: 330, kind: 'idea', origin: 'ai' }),
      )

      if (!human || !voice || !state || !reasoning || !documentNode) {
        throw new Error('Canvas did not initialize in time for the demo.')
      }

      await Promise.resolve(canvasRef.current.connectNodes({ fromId: human, toId: voice, label: 'speaks', origin: 'ai' }))
      await Promise.resolve(canvasRef.current.connectNodes({ fromId: voice, toId: state, label: 'maintains flow', origin: 'ai' }))
      await Promise.resolve(canvasRef.current.connectNodes({ fromId: voice, toId: reasoning, label: 'delegates', origin: 'ai' }))
      await Promise.resolve(canvasRef.current.connectNodes({ fromId: reasoning, toId: state, label: 'returns insight', origin: 'ai' }))
      await Promise.resolve(canvasRef.current.connectNodes({ fromId: state, toId: documentNode, label: 'promote accepted work', origin: 'ai' }))

      const ids = [human, voice, state, reasoning, documentNode]
      canvasRef.current.highlightElementIds(ids)
      canvasRef.current.selectElementIds([])
      promoteElements(
        ids,
        'Realtime co-thinking architecture',
        'The voice agent owns the uninterrupted conversational loop. It delegates difficult work to a reasoning agent, coordinates through shared session state, and promotes only accepted canvas decisions into the durable document.',
        'demo',
      )
      const reply =
        'I created a complete co-thinking loop, connected the responsibilities, and promoted the accepted architecture with traceable canvas sources.'
      addTranscript('voice', reply)
      speakRef.current(reply)
      addEvent('Autonomous demo complete', 'Voice → canvas → accepted document')
    } finally {
      setBusy(false)
    }
  }, [addEvent, addTranscript, busy, promoteElements])

  useEffect(() => {
    fetch('/api/health')
      .then(async (response) => {
        if (!response.ok) throw new Error('Local server is not ready')
        return response.json() as Promise<{ openaiConfigured?: boolean }>
      })
      .then((data) =>
        setHealth({
          loading: false,
          apiConfigured: Boolean(data.openaiConfigured),
          message: data.openaiConfigured
            ? 'OpenAI Realtime is available'
            : 'Local voice and demo mode are ready',
        }),
      )
      .catch(() =>
        setHealth({
          loading: false,
          apiConfigured: false,
          message: 'Local voice and demo mode are ready',
        }),
      )
  }, [])

  useEffect(() => {
    const persistedValue: PersistedWorkspace = {
      sections,
      transcript: transcript.slice(-80),
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persistedValue))
  }, [sections, transcript])

  useEffect(
    () => () => {
      realtimeRef.current?.disconnect()
    },
    [],
  )

  useEffect(() => {
    window.__cothinker = {
      runDemo,
      sendText: submitText,
      getState: () => ({ scene: getScene(), sections, transcript }),
    }
    return () => {
      delete window.__cothinker
    }
  }, [getScene, runDemo, sections, submitText, transcript])

  const markdown = useMemo(() => buildMarkdown(sections), [sections])

  const downloadMarkdown = () => {
    const blob = new Blob([markdown], { type: 'text/markdown' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = 'co-thinking-design.md'
    link.click()
    URL.revokeObjectURL(link.href)
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">◎</div>
          <div>
            <p className="eyebrow">Independent proof of concept</p>
            <h1>CoThinker</h1>
          </div>
        </div>
        <div className="topbar-status" aria-live="polite">
          <span className={`presence-dot ${isRealtimeConnected ? 'connected' : ''}`} />
          <div>
            <strong>{isRealtimeConnected ? 'Live with OpenAI' : 'Local co-thinking mode'}</strong>
            <span>{voiceStatus}</span>
          </div>
          <button className="session-reset" type="button" onClick={resetWorkspace}>
            New session
          </button>
        </div>
      </header>

      <section className="workspace-grid">
        <aside className="panel voice-panel" aria-label="Conversation">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Realtime loop</p>
              <h2>Conversation</h2>
            </div>
            <span className="step-number">1</span>
          </div>

          <div className="voice-orb-wrap">
            <button
              className={`voice-orb ${browserVoice.isListening ? 'listening' : ''}`}
              type="button"
              onClick={browserVoice.isListening ? browserVoice.stop : browserVoice.start}
              disabled={!browserVoice.supported || isRealtimeConnected}
              aria-label={browserVoice.isListening ? 'Stop browser voice' : 'Start browser voice'}
            >
              <span className="voice-wave" aria-hidden="true"><i /><i /><i /><i /></span>
            </button>
            <strong>{browserVoice.isListening ? 'Listening — interrupt anytime' : 'Tap to speak'}</strong>
            <span>{browserVoice.supported ? 'Browser voice works without an API key' : 'Use the text box or autonomous demo'}</span>
          </div>

          <div className="mode-actions">
            <button
              className="button primary"
              type="button"
              onClick={runDemo}
              disabled={busy}
              data-testid="run-demo"
            >
              {busy ? 'Working…' : 'Run autonomous demo'}
            </button>
            <button
              className="button secondary"
              type="button"
              onClick={connectRealtime}
              disabled={isConnecting || (!health.apiConfigured && !isRealtimeConnected)}
              title={health.apiConfigured ? 'Connect to OpenAI Realtime' : 'Set OPENAI_API_KEY on the local server to enable'}
            >
              {isRealtimeConnected ? 'Disconnect live AI' : isConnecting ? 'Connecting…' : 'Connect OpenAI Realtime'}
            </button>
            <p className="availability-note">{health.loading ? 'Checking capabilities…' : health.message}</p>
          </div>

          <form
            className="prompt-box"
            onSubmit={(event) => {
              event.preventDefault()
              void submitText(typedInput)
            }}
          >
            <label htmlFor="typed-prompt">Speak or type a design move</label>
            <textarea
              id="typed-prompt"
              value={typedInput}
              onChange={(event) => setTypedInput(event.target.value)}
              placeholder="Try: add an archivist agent"
              rows={3}
            />
            <button className="send-button" type="submit" disabled={!typedInput.trim() || busy}>Send</button>
          </form>

          {(browserVoice.error || interimText) && (
            <p className="interim" role="status">{browserVoice.error || interimText}</p>
          )}

          <div className="transcript" data-testid="transcript">
            {transcript.length === 0 ? (
              <div className="empty-state compact">
                <strong>The conversation will appear here.</strong>
                <span>Voice and canvas stay active at the same time.</span>
              </div>
            ) : (
              transcript.slice(-12).map((entry) => (
                <article className={`transcript-line ${entry.speaker}`} key={entry.id}>
                  <span>{entry.speaker === 'human' ? 'You' : entry.speaker === 'voice' ? 'CoThinker' : 'System'}</span>
                  <p>{entry.text}</p>
                </article>
              ))
            )}
          </div>
        </aside>

        <section className="panel canvas-panel" aria-label="Shared canvas">
          <div className="panel-heading canvas-heading">
            <div>
              <p className="eyebrow">Living working memory</p>
              <h2>Shared canvas</h2>
            </div>
            <div className="canvas-meta">
              <span>{scene.elementCount ?? scene.elements.length} elements</span>
              <span>{selectedIds.length} selected</span>
              <span className="step-number">2</span>
            </div>
          </div>
          <div className="canvas-stage" data-testid="canvas-stage">
            <CanvasBoard
              ref={canvasRef}
              onSceneChange={(nextScene) => setScene(nextScene as unknown as SceneSummaryLike)}
              onSelectionChange={setSelectedIds}
            />
          </div>
          <footer className="canvas-footer">
            <span><i className="legend-dot human" /> Human work</span>
            <span><i className="legend-dot ai" /> AI proposal</span>
            <span>Every change remains editable and undoable.</span>
            <button
              className="canvas-footer-action"
              type="button"
              onClick={() => canvasRef.current?.clearAiProposals()}
              disabled={!scene.aiElementCount}
            >
              Clear AI proposals
            </button>
          </footer>
        </section>

        <aside className="panel document-panel" aria-label="Accepted design document">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Durable understanding</p>
              <h2>Accepted design</h2>
            </div>
            <span className="step-number">3</span>
          </div>

          <div className="promotion-card">
            <label htmlFor="section-title">Section title</label>
            <input
              id="section-title"
              value={documentTitle}
              onChange={(event) => setDocumentTitle(event.target.value)}
            />
            <button
              className="button promote"
              type="button"
              onClick={() => promoteElements(selectedIds)}
              disabled={selectedIds.length === 0}
              data-testid="promote-selection"
            >
              Promote selection · {selectedIds.length}
            </button>
            <p>Only work you explicitly promote becomes durable.</p>
          </div>

          <div className="document-sections" data-testid="document-sections">
            {sections.length === 0 ? (
              <div className="empty-state">
                <strong>No accepted decisions yet.</strong>
                <span>Select canvas elements, then promote them one section at a time.</span>
              </div>
            ) : (
              sections.map((section, index) => (
                <article className="document-section" key={section.id}>
                  <div>
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <small>{section.elementIds.length} canvas sources</small>
                  </div>
                  <h3>{section.title}</h3>
                  <p>{section.body}</p>
                  <code>{section.elementIds.join(' · ')}</code>
                </article>
              ))
            )}
          </div>

          <details className="markdown-preview">
            <summary>View generated Markdown</summary>
            <pre>{markdown}</pre>
          </details>

          <div className="document-actions">
            <button className="button secondary" type="button" onClick={() => void navigator.clipboard?.writeText(markdown)}>Copy Markdown</button>
            <button className="button ghost" type="button" onClick={downloadMarkdown}>Download</button>
          </div>

          <div className="activity-log">
            <h3>Trace</h3>
            {events.slice(0, 5).map((event) => (
              <div key={event.id}>
                <i />
                <p><strong>{event.label}</strong><span>{event.detail}</span></p>
              </div>
            ))}
          </div>
        </aside>
      </section>
    </main>
  )
}

export default App
