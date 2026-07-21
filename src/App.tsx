import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { CanvasBoard, type CanvasBoardHandle } from './components/CanvasBoard'
import { executeCanvasTool } from './canvas/canvasTools'
import type { SceneSummary } from './canvas'
import { buildMarkdown, makeId, nowIso, type DesignSection, type Speaker } from './domain'
import { RealtimeVoiceClient, type RealtimeConnectionStatus } from './realtime'
import {
  workspacePersistence,
  workspaceReducer,
  type WorkspaceState,
} from './workspace'
import './App.css'

interface HealthState {
  loading: boolean
  apiConfigured: boolean
  message: string
}

const EMPTY_SCENE: SceneSummary = {
  version: 0,
  elementCount: 0,
  nodeCount: 0,
  connectionCount: 0,
  humanElementCount: 0,
  aiElementCount: 0,
  selectedElementIds: [],
  elements: [],
  nodes: [],
  connections: [],
}

function loadWorkspace(): WorkspaceState {
  return workspacePersistence.load(window.localStorage)
}

function App() {
  const canvasRef = useRef<CanvasBoardHandle>(null)
  const realtimeRef = useRef<RealtimeVoiceClient | null>(null)
  const [workspace, dispatch] = useReducer(workspaceReducer, undefined, loadWorkspace)
  const workspaceRef = useRef(workspace)
  const [health, setHealth] = useState<HealthState>({
    loading: true,
    apiConfigured: false,
    message: 'Checking OpenAI Realtime setup…',
  })
  const [isConnecting, setIsConnecting] = useState(false)
  const [typedInput, setTypedInput] = useState('')
  const [scene, setScene] = useState<SceneSummary>(EMPTY_SCENE)

  const isRealtimeConnected = isActiveConnection(workspace.session.status)
  const addTranscript = useCallback((speaker: Speaker, text: string) => {
    dispatch({ type: 'add-transcript', speaker, text })
  }, [])
  const addEvent = useCallback((label: string, detail: string) => {
    dispatch({ type: 'add-event', label, detail })
  }, [])
  const getScene = useCallback(
    () => canvasRef.current?.getSceneSummary() ?? scene,
    [scene],
  )

  const promoteElements = useCallback(
    (elementIds: string[], suppliedTitle?: string) => {
      const currentScene = getScene()
      const ids = elementIds.length > 0 ? elementIds : workspace.selectedIds
      const selected = currentScene.elements.filter((element) => ids.includes(element.id))
      if (selected.length === 0) {
        addTranscript('system', 'Select one or more canvas elements before promoting them.')
        return
      }
      const title = suppliedTitle?.trim() || 'Accepted design direction'
      const section: DesignSection = {
        id: makeId('section'),
        title,
        body: [
          'Accepted from the shared canvas:',
          '',
          ...selected.map((element) => `- ${element.label || element.text || element.type}`),
        ].join('\n'),
        elementIds: selected.map((element) => element.id),
        createdAt: nowIso(),
        source: 'human',
      }
      dispatch({ type: 'add-section', section })
      addEvent('Promoted to document', `${section.title} · ${section.elementIds.length} source elements`)
    },
    [addEvent, addTranscript, getScene, workspace.selectedIds],
  )

  const requestHumanPromotion = useCallback((nodeIds: string[], title?: string) => {
    canvasRef.current?.selectElementIds(nodeIds)
    if (title?.trim()) {
      addTranscript('system', `The collaborator suggested “${title.trim()}”. Review the selected work and promote it only if you accept it.`)
    } else {
      addTranscript('system', 'The collaborator requested promotion. Review the selected work and promote it only if you accept it.')
    }
  }, [addTranscript])

  const delegateReasoning = useCallback(
    async ({ prompt, context }: { prompt: string; context?: string }) => {
      try {
        const response = await fetch('/api/reason', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, context, canvas: getScene() }),
        })
        const payload: unknown = await response.json().catch(() => undefined)
        if (!response.ok) {
          const message = readApiError(payload, 'The reasoning request was rejected.')
          return { ok: false, error: { code: 'REASONING_REQUEST_FAILED', message, status: response.status } }
        }
        if (!isRecord(payload) || typeof payload.text !== 'string' || !payload.text.trim()) {
          return { ok: false, error: { code: 'REASONING_EMPTY_RESPONSE', message: 'The reasoning service completed without a usable response.' } }
        }
        return { ok: true, text: payload.text.trim() }
      } catch (error) {
        return {
          ok: false,
          error: {
            code: 'REASONING_NETWORK_ERROR',
            message: error instanceof Error ? error.message : 'The reasoning service could not be reached.',
          },
        }
      }
    },
    [getScene],
  )

  const handleToolCall = useCallback(
    (name: Parameters<typeof executeCanvasTool>[0], rawArgs: unknown) =>
      executeCanvasTool(name, rawArgs, {
        canvas: canvasRef.current,
        getScene,
        selectedIds: () => workspaceRef.current.selectedIds,
        addEvent,
        requestHumanPromotion,
        delegateReasoning,
      }),
    [addEvent, delegateReasoning, getScene, requestHumanPromotion],
  )

  const submitText = useCallback((text: string) => {
    const normalized = text.trim()
    if (!normalized) return
    setTypedInput('')
    const client = realtimeRef.current
    if (!client?.isConnected) {
      addTranscript('system', 'Connect OpenAI Realtime before sending a message.')
      return
    }
    try {
      client.sendText(normalized)
    } catch (error) {
      addTranscript('system', error instanceof Error ? error.message : 'The message could not be sent.')
    }
  }, [addTranscript])

  const disconnectRealtime = useCallback(() => {
    realtimeRef.current?.disconnect()
    realtimeRef.current = null
    dispatch({ type: 'set-session', status: 'idle', message: 'Disconnected from OpenAI Realtime.' })
  }, [])

  const connectRealtime = useCallback(async () => {
    if (realtimeRef.current?.isConnected) {
      disconnectRealtime()
      return
    }
    if (!health.apiConfigured) return
    setIsConnecting(true)
    const client = new RealtimeVoiceClient({
      onStatus: (status, message) => {
        dispatch({ type: 'set-session', status, message: message || status })
      },
      onUserTranscript: (text) => addTranscript('human', text),
      onAssistantTranscript: (text) => addTranscript('voice', text),
      onToolCall: handleToolCall,
    })
    realtimeRef.current = client
    try {
      await client.connect()
    } catch {
      realtimeRef.current = null
    } finally {
      setIsConnecting(false)
    }
  }, [addTranscript, disconnectRealtime, handleToolCall, health.apiConfigured])

  const resetWorkspace = useCallback(() => {
    disconnectRealtime()
    canvasRef.current?.clear()
    workspacePersistence.clear(window.localStorage)
    dispatch({ type: 'clear' })
    setTypedInput('')
    setScene(EMPTY_SCENE)
  }, [disconnectRealtime])

  useEffect(() => {
    fetch('/api/health')
      .then(async (response) => {
        if (!response.ok) throw new Error('The local server is not ready.')
        return response.json() as Promise<{ openaiConfigured?: boolean }>
      })
      .then((data) => setHealth({
        loading: false,
        apiConfigured: Boolean(data.openaiConfigured),
        message: data.openaiConfigured
          ? 'OpenAI Realtime is ready to connect.'
          : 'Setup required: set OPENAI_API_KEY on the server and restart it.',
      }))
      .catch(() => setHealth({
        loading: false,
        apiConfigured: false,
        message: 'Setup required: start the local server and configure OPENAI_API_KEY.',
      }))
  }, [])

  useEffect(() => {
    workspacePersistence.save(window.localStorage, workspace)
    workspaceRef.current = workspace
  }, [workspace])

  useEffect(() => {
    dispatch({ type: 'set-session', status: 'idle', message: 'Connect OpenAI Realtime to start collaborating.' })
    return () => realtimeRef.current?.disconnect()
  }, [])

  const markdown = useMemo(() => buildMarkdown(workspace.sections), [workspace.sections])
  const [documentTitle, setDocumentTitle] = useState('Accepted design direction')

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">◎</div>
          <div>
            <p className="eyebrow">Shared thinking space</p>
            <h1>CoThinker</h1>
          </div>
        </div>
        <div className="topbar-status" aria-live="polite">
          <span className={`presence-dot ${isRealtimeConnected ? 'connected' : ''}`} />
          <div>
            <strong>{isRealtimeConnected ? 'Live with OpenAI' : health.apiConfigured ? 'Ready for OpenAI' : 'Setup required'}</strong>
            <span>{workspace.session.message}</span>
          </div>
          <button className="session-reset" type="button" onClick={resetWorkspace}>New session</button>
        </div>
      </header>

      <section className="workspace-grid">
        <aside className="panel voice-panel" aria-label="Conversation">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Realtime collaborator</p>
              <h2>Conversation</h2>
            </div>
            <span className="step-number">1</span>
          </div>

          <div className="voice-orb-wrap">
            <button
              className={`voice-orb ${isRealtimeConnected ? 'listening' : ''}`}
              type="button"
              onClick={() => void connectRealtime()}
              disabled={isConnecting || (!health.apiConfigured && !isRealtimeConnected)}
              aria-label={isRealtimeConnected ? 'Disconnect OpenAI Realtime' : 'Connect OpenAI Realtime'}
            >
              <span className="voice-wave" aria-hidden="true"><i /><i /><i /><i /></span>
            </button>
            <strong>{isRealtimeConnected ? 'Listening — interrupt anytime' : 'Connect to use microphone AI'}</strong>
            <span>{health.loading ? 'Checking capabilities…' : health.message}</span>
          </div>

          <div className="mode-actions">
            <button
              className="button primary"
              type="button"
              onClick={() => void connectRealtime()}
              disabled={isConnecting || (!health.apiConfigured && !isRealtimeConnected)}
            >
              {isRealtimeConnected ? 'Disconnect live AI' : isConnecting ? 'Connecting…' : 'Connect OpenAI Realtime'}
            </button>
            {!health.apiConfigured && !health.loading && (
              <p className="availability-note">Manual canvas editing and human document promotion remain available while setup is incomplete.</p>
            )}
          </div>

          <form
            className="prompt-box"
            onSubmit={(event) => {
              event.preventDefault()
              submitText(typedInput)
            }}
          >
            <label htmlFor="typed-prompt">Message the connected collaborator</label>
            <textarea
              id="typed-prompt"
              value={typedInput}
              onChange={(event) => setTypedInput(event.target.value)}
              placeholder="Connect OpenAI Realtime to send a message"
              rows={3}
              disabled={!isRealtimeConnected}
            />
            <button className="send-button" type="submit" disabled={!typedInput.trim() || !isRealtimeConnected}>Send</button>
          </form>

          <div className="transcript" data-testid="transcript">
            {workspace.transcript.length === 0 ? (
              <div className="empty-state compact">
                <strong>The realtime conversation will appear here.</strong>
                <span>Connect OpenAI Realtime, then speak or send a message.</span>
              </div>
            ) : (
              workspace.transcript.slice(-12).map((entry) => (
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
              <span>{scene.elementCount} elements</span>
              <span>{workspace.selectedIds.length} selected</span>
              <span className="step-number">2</span>
            </div>
          </div>
          <div className="canvas-stage" data-testid="canvas-stage">
            <CanvasBoard
              ref={canvasRef}
              initialScene={workspace.scene}
              onSceneChange={setScene}
              onSceneSerialized={(serializedScene) => dispatch({ type: 'set-scene', scene: serializedScene })}
              onSelectionChange={(selectedIds) => dispatch({ type: 'set-selection', selectedIds })}
            />
          </div>
          <footer className="canvas-footer">
            <span><i className="legend-dot human" /> Human work</span>
            <span><i className="legend-dot ai" /> AI proposal</span>
            <span>AI proposals remain editable and removable.</span>
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
            <input id="section-title" value={documentTitle} onChange={(event) => setDocumentTitle(event.target.value)} />
            <button
              className="button promote"
              type="button"
              onClick={() => promoteElements(workspace.selectedIds, documentTitle)}
              disabled={workspace.selectedIds.length === 0}
              data-testid="promote-selection"
            >
              Promote selection · {workspace.selectedIds.length}
            </button>
            <p>Only work you explicitly promote becomes durable.</p>
          </div>

          <div className="document-sections" data-testid="document-sections">
            {workspace.sections.length === 0 ? (
              <div className="empty-state">
                <strong>No accepted decisions yet.</strong>
                <span>Select canvas elements, then promote them one section at a time.</span>
              </div>
            ) : (
              workspace.sections.map((section, index) => (
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
            <button className="button ghost" type="button" onClick={() => downloadMarkdown(markdown)}>Download</button>
          </div>

          <div className="activity-log">
            <h3>Trace</h3>
            {workspace.events.slice(0, 5).map((event) => (
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

function isActiveConnection(status: RealtimeConnectionStatus): boolean {
  return status === 'connected' || status === 'listening' || status === 'thinking' || status === 'speaking'
}

function readApiError(payload: unknown, fallback: string): string {
  return isRecord(payload) && typeof payload.error === 'string' ? payload.error : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function downloadMarkdown(markdown: string): void {
  const blob = new Blob([markdown], { type: 'text/markdown' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = 'co-thinking-design.md'
  link.click()
  URL.revokeObjectURL(link.href)
}

export default App
