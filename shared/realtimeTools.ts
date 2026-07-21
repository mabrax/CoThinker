export const REALTIME_TOOL_NAMES = [
  'get_canvas_state',
  'add_canvas_node',
  'connect_canvas_nodes',
  'promote_to_document',
  'delegate_reasoning',
] as const

export type RealtimeToolName = (typeof REALTIME_TOOL_NAMES)[number]

export interface GetCanvasStateArgs {}

export interface AddCanvasNodeArgs {
  label: string
  kind?: string
  details?: string
  x?: number
  y?: number
}

export interface ConnectCanvasNodesArgs {
  sourceId: string
  targetId: string
  label?: string
}

export interface PromoteToDocumentArgs {
  nodeIds: string[]
  title?: string
}

export interface DelegateReasoningArgs {
  prompt: string
  context?: string
}

export interface RealtimeToolArgumentsByName {
  get_canvas_state: GetCanvasStateArgs
  add_canvas_node: AddCanvasNodeArgs
  connect_canvas_nodes: ConnectCanvasNodesArgs
  promote_to_document: PromoteToDocumentArgs
  delegate_reasoning: DelegateReasoningArgs
}

export type RealtimeToolArguments =
  RealtimeToolArgumentsByName[RealtimeToolName]

interface RealtimeToolDefinition {
  type: 'function'
  name: RealtimeToolName
  description: string
  parameters: Record<string, unknown>
}

export const REALTIME_TOOL_DEFINITIONS: readonly RealtimeToolDefinition[] = [
  {
    type: 'function',
    name: 'get_canvas_state',
    description: 'Read the current canvas nodes, connections, and selected items.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
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
      additionalProperties: false,
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
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'promote_to_document',
    description: 'Request that the human explicitly promote selected canvas ideas into the document.',
    parameters: {
      type: 'object',
      properties: {
        nodeIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Canvas node IDs the human may choose to promote.',
        },
        title: { type: 'string', description: 'Optional suggested document title.' },
      },
      required: ['nodeIds'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'delegate_reasoning',
    description: 'Ask the server-side reasoning model for a focused synthesis.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The focused reasoning question.' },
        context: { type: 'string', description: 'Optional concise canvas context.' },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
  },
]

export function isRealtimeToolName(value: string): value is RealtimeToolName {
  return (REALTIME_TOOL_NAMES as readonly string[]).includes(value)
}
