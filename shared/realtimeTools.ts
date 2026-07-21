export const REALTIME_TOOL_NAMES = [
  'get_canvas_state',
  'add_canvas_node',
  'update_canvas_elements',
  'group_canvas_elements',
  'delete_canvas_elements',
  'merge_canvas_nodes',
  'connect_canvas_nodes',
  'layout_canvas_elements',
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

export interface UpdateCanvasElementsArgs {
  elementIds: string[]
  label?: string
  x?: number
  y?: number
  width?: number
  height?: number
}

export interface GroupCanvasElementsArgs {
  elementIds: string[]
  name: string
}

export interface DeleteCanvasElementsArgs {
  elementIds: string[]
}

export interface MergeCanvasNodesArgs {
  nodeIds: string[]
  label?: string
  kind?: string
  x?: number
  y?: number
}

export interface ConnectCanvasNodesArgs {
  sourceId: string
  targetId: string
  label?: string
}

export interface LayoutCanvasElementsArgs {
  elementIds: string[]
  operation: 'align' | 'distribute' | 'snap'
  alignment?: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
  axis?: 'horizontal' | 'vertical'
  gridSize?: number
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
  update_canvas_elements: UpdateCanvasElementsArgs
  group_canvas_elements: GroupCanvasElementsArgs
  delete_canvas_elements: DeleteCanvasElementsArgs
  merge_canvas_nodes: MergeCanvasNodesArgs
  connect_canvas_nodes: ConnectCanvasNodesArgs
  layout_canvas_elements: LayoutCanvasElementsArgs
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
    name: 'update_canvas_elements',
    description: 'Propose a reversible rename, label, position, or size change for existing canvas elements.',
    parameters: {
      type: 'object',
      properties: {
        elementIds: { type: 'array', items: { type: 'string' }, description: 'IDs of existing nodes or connections to update.' },
        label: { type: 'string', description: 'Replacement label for each selected element.' },
        x: { type: 'number', description: 'Optional horizontal position.' },
        y: { type: 'number', description: 'Optional vertical position.' },
        width: { type: 'number', description: 'Optional width; must be positive.' },
        height: { type: 'number', description: 'Optional height; must be positive.' },
      },
      required: ['elementIds'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'group_canvas_elements',
    description: 'Propose grouping existing canvas elements into a named Excalidraw group.',
    parameters: {
      type: 'object',
      properties: {
        elementIds: { type: 'array', items: { type: 'string' }, description: 'IDs of existing elements to group.' },
        name: { type: 'string', description: 'Human-readable group or layer name.' },
      },
      required: ['elementIds', 'name'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'delete_canvas_elements',
    description: 'Propose deletion of existing canvas elements; human-owned originals remain recoverable until acceptance.',
    parameters: {
      type: 'object',
      properties: {
        elementIds: { type: 'array', items: { type: 'string' }, description: 'IDs of existing elements to delete.' },
      },
      required: ['elementIds'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'merge_canvas_nodes',
    description: 'Propose merging two or more existing nodes into one named node while preserving reversible lineage.',
    parameters: {
      type: 'object',
      properties: {
        nodeIds: { type: 'array', items: { type: 'string' }, description: 'Two or more node IDs to merge.' },
        label: { type: 'string', description: 'Optional label for the merged node.' },
        kind: { type: 'string', description: 'Optional node category for the merged node.' },
        x: { type: 'number', description: 'Optional horizontal position for the merged node.' },
        y: { type: 'number', description: 'Optional vertical position for the merged node.' },
      },
      required: ['nodeIds'],
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
    name: 'layout_canvas_elements',
    description: 'Propose aligning, distributing, or snapping existing canvas nodes to a configurable grid.',
    parameters: {
      type: 'object',
      properties: {
        elementIds: { type: 'array', items: { type: 'string' }, description: 'IDs of existing nodes to lay out.' },
        operation: { type: 'string', enum: ['align', 'distribute', 'snap'] },
        alignment: { type: 'string', enum: ['left', 'center', 'right', 'top', 'middle', 'bottom'] },
        axis: { type: 'string', enum: ['horizontal', 'vertical'] },
        gridSize: { type: 'number', description: 'Grid spacing for snap; defaults to 20.' },
      },
      required: ['elementIds', 'operation'],
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
