import type { CanvasBoardHandle, SceneSummary } from './types'
import type {
  RealtimeToolArgumentsByName,
  RealtimeToolName,
} from '../../shared/realtimeTools'

export interface CanvasToolService {
  canvas: CanvasBoardHandle | null
  getScene(): SceneSummary
  selectedIds(): string[]
  addEvent(label: string, detail: string): void
  requestHumanPromotion(nodeIds: string[], title?: string): void
  delegateReasoning(input: RealtimeToolArgumentsByName['delegate_reasoning']): Promise<unknown>
}

type ToolResult =
  | { ok: true; [key: string]: unknown }
  | { ok: false; error: { code: string; message: string; status?: number } }

export async function executeCanvasTool(
  name: RealtimeToolName,
  rawArgs: unknown,
  service: CanvasToolService,
): Promise<ToolResult | SceneSummary> {
  switch (name) {
    case 'get_canvas_state': {
      const args = parseEmptyArgs(rawArgs)
      if (!args.ok) return args
      return service.getScene()
    }
    case 'add_canvas_node': {
      const args = parseAddNodeArgs(rawArgs)
      if (!args.ok) return args
      const canvas = service.canvas
      if (!canvas) return unavailableCanvas()
      const id = canvas.addNode({ ...args.value, origin: 'ai' })
      service.addEvent('Realtime canvas proposal', `Added ${args.value.label}`)
      return { ok: true, id }
    }
    case 'update_canvas_elements': {
      const args = parseUpdateArgs(rawArgs)
      if (!args.ok) return args
      const canvas = service.canvas
      if (!canvas) return unavailableCanvas()
      const missing = missingElementIds(service.getScene(), args.value.elementIds)
      if (missing.length > 0) return error('INVALID_CANVAS_REFERENCE', `Unknown canvas element IDs: ${missing.join(', ')}`)
      const ids = canvas.updateElements(args.value)
      if (ids.length === 0) return error('CANVAS_UPDATE_FAILED', 'The canvas could not apply that update.')
      service.addEvent('Realtime canvas proposal', `Updated ${args.value.elementIds.length} canvas element${args.value.elementIds.length === 1 ? '' : 's'}.`)
      return { ok: true, ids }
    }
    case 'group_canvas_elements': {
      const args = parseGroupArgs(rawArgs)
      if (!args.ok) return args
      const canvas = service.canvas
      if (!canvas) return unavailableCanvas()
      const missing = missingElementIds(service.getScene(), args.value.elementIds)
      if (missing.length > 0) return error('INVALID_CANVAS_REFERENCE', `Unknown canvas element IDs: ${missing.join(', ')}`)
      const ids = canvas.groupElements(args.value)
      if (ids.length === 0) return error('GROUP_FAILED', 'The canvas could not create that named group.')
      service.addEvent('Realtime canvas proposal', `Grouped ${args.value.elementIds.length} elements as “${args.value.name}”.`)
      return { ok: true, ids, groupName: args.value.name }
    }
    case 'delete_canvas_elements': {
      const args = parseDeleteArgs(rawArgs)
      if (!args.ok) return args
      const canvas = service.canvas
      if (!canvas) return unavailableCanvas()
      const missing = missingElementIds(service.getScene(), args.value.elementIds)
      if (missing.length > 0) return error('INVALID_CANVAS_REFERENCE', `Unknown canvas element IDs: ${missing.join(', ')}`)
      const ids = canvas.deleteElements(args.value.elementIds)
      if (ids.length === 0 && service.getScene().elements.some((element) => args.value.elementIds.includes(element.id) && element.origin === 'ai')) {
        return { ok: true, ids: [], removed: args.value.elementIds }
      }
      if (ids.length === 0) return error('DELETE_FAILED', 'The canvas could not create that deletion proposal.')
      service.addEvent('Realtime canvas proposal', `Proposed deletion of ${args.value.elementIds.length} canvas element${args.value.elementIds.length === 1 ? '' : 's'}.`)
      return { ok: true, ids, proposal: true }
    }
    case 'merge_canvas_nodes': {
      const args = parseMergeArgs(rawArgs)
      if (!args.ok) return args
      const canvas = service.canvas
      if (!canvas) return unavailableCanvas()
      const nodeIds = new Set(service.getScene().nodes.map((node) => node.id))
      const missing = args.value.nodeIds.filter((id) => !nodeIds.has(id))
      if (missing.length > 0) return error('INVALID_CANVAS_REFERENCE', `Unknown canvas node IDs: ${missing.join(', ')}`)
      const id = canvas.mergeNodes(args.value)
      if (!id) return error('MERGE_FAILED', 'The canvas could not merge those nodes.')
      service.addEvent('Realtime canvas proposal', `Merged ${args.value.nodeIds.length} canvas nodes.`)
      return { ok: true, id }
    }
    case 'connect_canvas_nodes': {
      const args = parseConnectNodesArgs(rawArgs)
      if (!args.ok) return args
      const canvas = service.canvas
      if (!canvas) return unavailableCanvas()
      const nodeIds = new Set(service.getScene().nodes.map((node) => node.id))
      if (!nodeIds.has(args.value.sourceId) || !nodeIds.has(args.value.targetId)) {
        return error('INVALID_CANVAS_REFERENCE', 'Both connection endpoints must be existing canvas nodes.')
      }
      if (args.value.sourceId === args.value.targetId) {
        return error('INVALID_CANVAS_REFERENCE', 'A connection must have different source and target nodes.')
      }
      if (service.getScene().connections.some((connection) => connection.fromId === args.value.sourceId && connection.toId === args.value.targetId)) {
        return error('CONNECTION_EXISTS', 'Those canvas nodes are already connected.')
      }
      const id = canvas.connectNodes({
        fromId: args.value.sourceId,
        toId: args.value.targetId,
        label: args.value.label,
        origin: 'ai',
      })
      if (!id) return error('CONNECTION_FAILED', 'The canvas could not create that connection.')
      service.addEvent('Realtime canvas proposal', `Connected ${args.value.sourceId} → ${args.value.targetId}`)
      return { ok: true, id }
    }
    case 'layout_canvas_elements': {
      const args = parseLayoutArgs(rawArgs)
      if (!args.ok) return args
      const canvas = service.canvas
      if (!canvas) return unavailableCanvas()
      const nodeIds = new Set(service.getScene().nodes.map((node) => node.id))
      const missing = args.value.elementIds.filter((id) => !nodeIds.has(id))
      if (missing.length > 0) return error('INVALID_CANVAS_REFERENCE', `Layout targets must be existing canvas node IDs: ${missing.join(', ')}`)
      const ids = canvas.layoutElements(args.value)
      if (ids.length === 0) return error('LAYOUT_FAILED', 'The canvas could not apply that layout operation.')
      service.addEvent('Realtime canvas proposal', `Applied ${args.value.operation} layout to ${args.value.elementIds.length} canvas nodes.`)
      return { ok: true, ids, operation: args.value.operation }
    }
    case 'promote_to_document': {
      const args = parsePromotionArgs(rawArgs)
      if (!args.ok) return args
      const ids = args.value.nodeIds.length > 0 ? args.value.nodeIds : service.selectedIds()
      if (ids.length === 0) return error('NO_SELECTION', 'Select canvas work before requesting promotion.')
      service.requestHumanPromotion(ids, args.value.title)
      return error(
        'HUMAN_ACCEPTANCE_REQUIRED',
        'Document promotion was not performed. The human must explicitly confirm it in the Accepted design panel.',
      )
    }
    case 'delegate_reasoning': {
      const args = parseReasoningArgs(rawArgs)
      if (!args.ok) return args
      return service.delegateReasoning(args.value) as Promise<ToolResult>
    }
  }
}

function parseEmptyArgs(raw: unknown): ParseResult<Record<string, never>> {
  if (!isRecord(raw) || Object.keys(raw).length > 0) return invalid('This tool does not accept arguments.')
  return { ok: true, value: {} }
}

function parseAddNodeArgs(raw: unknown): ParseResult<RealtimeToolArgumentsByName['add_canvas_node']> {
  if (!isRecord(raw)) return invalid('Tool arguments must be an object.')
  const keys = rejectUnknownKeys(raw, ['label', 'kind', 'details', 'x', 'y'])
  if (!keys.ok) return keys
  const label = readNonEmptyString(raw.label, 'label')
  if (!label.ok) return label
  const kind = readOptionalString(raw.kind, 'kind')
  if (!kind.ok) return kind
  const details = readOptionalString(raw.details, 'details')
  if (!details.ok) return details
  const x = readOptionalNumber(raw.x, 'x')
  if (!x.ok) return x
  const y = readOptionalNumber(raw.y, 'y')
  if (!y.ok) return y
  return { ok: true, value: { label: label.value, kind: kind.value, details: details.value, x: x.value, y: y.value } }
}

function parseUpdateArgs(raw: unknown): ParseResult<RealtimeToolArgumentsByName['update_canvas_elements']> {
  if (!isRecord(raw)) return invalid('Tool arguments must be an object.')
  const keys = rejectUnknownKeys(raw, ['elementIds', 'label', 'x', 'y', 'width', 'height'])
  if (!keys.ok) return keys
  const elementIds = readElementIds(raw.elementIds)
  if (!elementIds.ok) return elementIds
  const label = readOptionalString(raw.label, 'label')
  if (!label.ok) return label
  const x = readOptionalNumber(raw.x, 'x')
  if (!x.ok) return x
  const y = readOptionalNumber(raw.y, 'y')
  if (!y.ok) return y
  const width = readPositiveNumber(raw.width, 'width')
  if (!width.ok) return width
  const height = readPositiveNumber(raw.height, 'height')
  if (!height.ok) return height
  if (label.value === undefined && x.value === undefined && y.value === undefined && width.value === undefined && height.value === undefined) {
    return invalid('Provide at least one label, position, or size change.')
  }
  return { ok: true, value: { elementIds: elementIds.value, label: label.value, x: x.value, y: y.value, width: width.value, height: height.value } }
}

function parseGroupArgs(raw: unknown): ParseResult<RealtimeToolArgumentsByName['group_canvas_elements']> {
  if (!isRecord(raw)) return invalid('Tool arguments must be an object.')
  const keys = rejectUnknownKeys(raw, ['elementIds', 'name'])
  if (!keys.ok) return keys
  const elementIds = readElementIds(raw.elementIds)
  if (!elementIds.ok) return elementIds
  const name = readNonEmptyString(raw.name, 'name')
  return name.ok ? { ok: true, value: { elementIds: elementIds.value, name: name.value } } : name
}

function parseDeleteArgs(raw: unknown): ParseResult<RealtimeToolArgumentsByName['delete_canvas_elements']> {
  if (!isRecord(raw)) return invalid('Tool arguments must be an object.')
  const keys = rejectUnknownKeys(raw, ['elementIds'])
  if (!keys.ok) return keys
  const elementIds = readElementIds(raw.elementIds)
  return elementIds.ok ? { ok: true, value: { elementIds: elementIds.value } } : elementIds
}

function parseMergeArgs(raw: unknown): ParseResult<RealtimeToolArgumentsByName['merge_canvas_nodes']> {
  if (!isRecord(raw)) return invalid('Tool arguments must be an object.')
  const keys = rejectUnknownKeys(raw, ['nodeIds', 'label', 'kind', 'x', 'y'])
  if (!keys.ok) return keys
  const nodeIds = readElementIds(raw.nodeIds, 2)
  if (!nodeIds.ok) return nodeIds
  const label = readOptionalString(raw.label, 'label')
  if (!label.ok) return label
  const kind = readOptionalString(raw.kind, 'kind')
  if (!kind.ok) return kind
  const x = readOptionalNumber(raw.x, 'x')
  if (!x.ok) return x
  const y = readOptionalNumber(raw.y, 'y')
  if (!y.ok) return y
  return { ok: true, value: { nodeIds: nodeIds.value, label: label.value, kind: kind.value, x: x.value, y: y.value } }
}

function parseLayoutArgs(raw: unknown): ParseResult<RealtimeToolArgumentsByName['layout_canvas_elements']> {
  if (!isRecord(raw)) return invalid('Tool arguments must be an object.')
  const keys = rejectUnknownKeys(raw, ['elementIds', 'operation', 'alignment', 'axis', 'gridSize'])
  if (!keys.ok) return keys
  const elementIds = readElementIds(raw.elementIds)
  if (!elementIds.ok) return elementIds
  if (raw.operation !== 'align' && raw.operation !== 'distribute' && raw.operation !== 'snap') return invalid('operation must be align, distribute, or snap.')
  const alignment = readEnum(raw.alignment, 'alignment', ['left', 'center', 'right', 'top', 'middle', 'bottom'] as const)
  if (!alignment.ok) return alignment
  const axis = readEnum(raw.axis, 'axis', ['horizontal', 'vertical'] as const)
  if (!axis.ok) return axis
  const gridSize = readPositiveNumber(raw.gridSize, 'gridSize')
  if (!gridSize.ok) return gridSize
  if (raw.operation === 'align' && alignment.value === undefined) return invalid('alignment is required for align.')
  if (raw.operation === 'align' && axis.value !== undefined) return invalid('axis is only valid for distribute.')
  if (raw.operation === 'distribute' && axis.value === undefined) return invalid('axis is required for distribute.')
  if (raw.operation === 'distribute' && alignment.value !== undefined) return invalid('alignment is only valid for align.')
  if (raw.operation === 'snap' && alignment.value !== undefined) return invalid('alignment is only valid for align.')
  if (raw.operation === 'snap' && axis.value !== undefined) return invalid('axis is only valid for distribute.')
  if (raw.operation !== 'snap' && gridSize.value !== undefined) return invalid('gridSize is only valid for snap.')
  return { ok: true, value: { elementIds: elementIds.value, operation: raw.operation, alignment: alignment.value, axis: axis.value, gridSize: gridSize.value } }
}

function parseConnectNodesArgs(raw: unknown): ParseResult<RealtimeToolArgumentsByName['connect_canvas_nodes']> {
  if (!isRecord(raw)) return invalid('Tool arguments must be an object.')
  const keys = rejectUnknownKeys(raw, ['sourceId', 'targetId', 'label'])
  if (!keys.ok) return keys
  const sourceId = readNonEmptyString(raw.sourceId, 'sourceId')
  if (!sourceId.ok) return sourceId
  const targetId = readNonEmptyString(raw.targetId, 'targetId')
  if (!targetId.ok) return targetId
  const label = readOptionalString(raw.label, 'label')
  if (!label.ok) return label
  return { ok: true, value: { sourceId: sourceId.value, targetId: targetId.value, label: label.value } }
}

function parsePromotionArgs(raw: unknown): ParseResult<RealtimeToolArgumentsByName['promote_to_document']> {
  if (isRecord(raw)) {
    const keys = rejectUnknownKeys(raw, ['nodeIds', 'title'])
    if (!keys.ok) return keys
  }
  if (!isRecord(raw) || !Array.isArray(raw.nodeIds) || !raw.nodeIds.every((id) => typeof id === 'string' && id.trim())) {
    return invalid('nodeIds must be an array of canvas IDs.')
  }
  const title = readOptionalString(raw.title, 'title')
  return !title.ok ? title : { ok: true, value: { nodeIds: raw.nodeIds.map((id) => id.trim()), title: title.value } }
}

function parseReasoningArgs(raw: unknown): ParseResult<RealtimeToolArgumentsByName['delegate_reasoning']> {
  if (!isRecord(raw)) return invalid('Tool arguments must be an object.')
  const keys = rejectUnknownKeys(raw, ['prompt', 'context'])
  if (!keys.ok) return keys
  const prompt = readNonEmptyString(raw.prompt, 'prompt')
  if (!prompt.ok) return prompt
  const context = readOptionalString(raw.context, 'context')
  if (!context.ok) return context
  return { ok: true, value: { prompt: prompt.value, context: context.value } }
}

type ParseResult<T> = { ok: true; value: T } | Extract<ToolResult, { ok: false }>

function readNonEmptyString(value: unknown, field: string): ParseResult<string> {
  if (typeof value !== 'string' || !value.trim()) return invalid(`${field} must be a non-empty string.`)
  if (value.trim().length > 280) return invalid(`${field} must be 280 characters or fewer.`)
  return { ok: true, value: value.trim() }
}

function readOptionalString(value: unknown, field: string): ParseResult<string | undefined> {
  if (value === undefined) return { ok: true, value: undefined }
  if (typeof value !== 'string') return invalid(`${field} must be a string.`)
  return value.trim().length <= 280 ? { ok: true, value: value.trim() || undefined } : invalid(`${field} must be 280 characters or fewer.`)
}

function readOptionalNumber(value: unknown, field: string): ParseResult<number | undefined> {
  if (value === undefined) return { ok: true, value: undefined }
  return typeof value === 'number' && Number.isFinite(value) ? { ok: true, value } : invalid(`${field} must be a finite number.`)
}

function readPositiveNumber(value: unknown, field: string): ParseResult<number | undefined> {
  const result = readOptionalNumber(value, field)
  if (!result.ok || result.value === undefined) return result
  return result.value > 0 ? result : invalid(`${field} must be greater than zero.`)
}

function readElementIds(value: unknown, minimum = 1): ParseResult<string[]> {
  if (!Array.isArray(value) || value.length < minimum || value.length > 50 || !value.every((id) => typeof id === 'string' && id.trim())) {
    return invalid(`elementIds must contain between ${minimum} and 50 non-empty canvas IDs.`)
  }
  const ids = [...new Set(value.map((id) => id.trim()))]
  if (ids.length < minimum) return invalid(`elementIds must contain at least ${minimum} distinct canvas IDs.`)
  return { ok: true, value: ids }
}

function readEnum<const T extends readonly string[]>(value: unknown, field: string, values: T): ParseResult<T[number] | undefined> {
  if (value === undefined) return { ok: true, value: undefined }
  return typeof value === 'string' && values.includes(value) ? { ok: true, value: value as T[number] } : invalid(`${field} must be one of: ${values.join(', ')}.`)
}

function rejectUnknownKeys(raw: Record<string, unknown>, allowed: readonly string[]): Extract<ToolResult, { ok: true }> | Extract<ToolResult, { ok: false }> {
  const unknown = Object.keys(raw).filter((key) => !allowed.includes(key))
  return unknown.length === 0 ? { ok: true } : invalid(`Unknown tool argument: ${unknown[0]}.`)
}

function missingElementIds(scene: SceneSummary, ids: readonly string[]) {
  const known = new Set(scene.elements.map((element) => element.id))
  return ids.filter((id) => !known.has(id))
}

function invalid(message: string): Extract<ToolResult, { ok: false }> {
  return error('INVALID_TOOL_ARGUMENTS', message)
}

function unavailableCanvas(): Extract<ToolResult, { ok: false }> {
  return error('CANVAS_UNAVAILABLE', 'The canvas is still loading. Try again after it is ready.')
}

function error(code: string, message: string, status?: number): Extract<ToolResult, { ok: false }> {
  return { ok: false, error: { code, message, status } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
