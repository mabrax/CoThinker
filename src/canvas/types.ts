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

export interface CanvasUpdateInput {
  elementIds: string[]
  label?: string
  x?: number
  y?: number
  width?: number
  height?: number
}

export interface CanvasGroupInput {
  elementIds: string[]
  name: string
}

export interface CanvasMergeInput {
  nodeIds: string[]
  label?: string
  kind?: CanvasNodeKind
  x?: number
  y?: number
}

export type CanvasLayoutOperation = 'align' | 'distribute' | 'snap'
export type CanvasAlignment = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
export type CanvasLayoutAxis = 'horizontal' | 'vertical'

export interface CanvasLayoutInput {
  elementIds: string[]
  operation: CanvasLayoutOperation
  alignment?: CanvasAlignment
  axis?: CanvasLayoutAxis
  gridSize?: number
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
  groupId?: string
  groupName?: string
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
  groupId?: string
  groupName?: string
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
  updateElements(input: CanvasUpdateInput): string[]
  groupElements(input: CanvasGroupInput): string[]
  deleteElements(elementIds: readonly string[]): string[]
  mergeNodes(input: CanvasMergeInput): string | null
  connectNodes(input: CanvasConnectionInput): string | null
  layoutElements(input: CanvasLayoutInput): string[]
  acceptProposals(elementIds: readonly string[]): string[]
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
