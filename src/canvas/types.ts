export type CanvasElementOrigin = 'human' | 'ai'

export type CanvasElementOriginInput =
  | CanvasElementOrigin
  | 'user'
  | 'assistant'

export type CanvasNodeKind =
  | 'rectangle'
  | 'ellipse'
  | 'diamond'
  | 'process'
  | 'idea'
  | 'decision'
  | (string & {})

export interface CanvasNodeInput {
  id?: string
  label: string
  x?: number
  y?: number
  kind?: CanvasNodeKind
  origin?: CanvasElementOriginInput
}

export interface CanvasConnectionInput {
  id?: string
  fromId: string
  toId: string
  label?: string
  origin?: CanvasElementOriginInput
}

export interface CanvasNodeSummary {
  id: string
  label: string
  kind: CanvasNodeKind
  origin: CanvasElementOrigin
  x: number
  y: number
  width: number
  height: number
}

export interface CanvasConnectionSummary {
  id: string
  fromId: string | null
  toId: string | null
  label: string | null
  origin: CanvasElementOrigin
}

export interface CanvasElementSummary {
  id: string
  type: string
  label: string | null
  text: string | null
  origin: CanvasElementOrigin
  x: number
  y: number
  width: number
  height: number
  customData?: Record<string, unknown>
}

export interface SceneSummary {
  version: number
  elementCount: number
  nodeCount: number
  connectionCount: number
  humanElementCount: number
  aiElementCount: number
  selectedElementIds: string[]
  elements: CanvasElementSummary[]
  nodes: CanvasNodeSummary[]
  connections: CanvasConnectionSummary[]
}

export interface CanvasBoardHandle {
  getSceneSummary(): SceneSummary
  addNode(input: CanvasNodeInput): string
  connectNodes(input: CanvasConnectionInput): string | null
  getSelectedElementIds(): string[]
  selectElementIds(elementIds: readonly string[]): void
  highlightElementIds(elementIds: readonly string[]): void
  exportScene(): string
  clear(): void
  clearAiProposals(): void
  reset(): void
}

export interface CanvasBoardProps {
  className?: string
  style?: React.CSSProperties
  initialScene?: string | null
  testId?: string
  onSceneChange?: (summary: SceneSummary) => void
  onSceneSerialized?: (scene: string) => void
  onSelectionChange?: (selectedElementIds: string[]) => void
}
