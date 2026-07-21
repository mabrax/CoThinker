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
    case 'get_canvas_state':
      return service.getScene()
    case 'add_canvas_node': {
      const args = parseAddNodeArgs(rawArgs)
      if (!args.ok) return args
      const canvas = service.canvas
      if (!canvas) return unavailableCanvas()
      const id = canvas.addNode({ ...args.value, origin: 'ai' })
      service.addEvent('Realtime canvas proposal', `Added ${args.value.label}`)
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

function parseAddNodeArgs(raw: unknown): ParseResult<RealtimeToolArgumentsByName['add_canvas_node']> {
  if (!isRecord(raw)) return invalid('Tool arguments must be an object.')
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

function parseConnectNodesArgs(raw: unknown): ParseResult<RealtimeToolArgumentsByName['connect_canvas_nodes']> {
  if (!isRecord(raw)) return invalid('Tool arguments must be an object.')
  const sourceId = readNonEmptyString(raw.sourceId, 'sourceId')
  if (!sourceId.ok) return sourceId
  const targetId = readNonEmptyString(raw.targetId, 'targetId')
  if (!targetId.ok) return targetId
  const label = readOptionalString(raw.label, 'label')
  if (!label.ok) return label
  return { ok: true, value: { sourceId: sourceId.value, targetId: targetId.value, label: label.value } }
}

function parsePromotionArgs(raw: unknown): ParseResult<RealtimeToolArgumentsByName['promote_to_document']> {
  if (!isRecord(raw) || !Array.isArray(raw.nodeIds) || !raw.nodeIds.every((id) => typeof id === 'string' && id.trim())) {
    return invalid('nodeIds must be an array of canvas IDs.')
  }
  const title = readOptionalString(raw.title, 'title')
  return !title.ok ? title : { ok: true, value: { nodeIds: raw.nodeIds.map((id) => id.trim()), title: title.value } }
}

function parseReasoningArgs(raw: unknown): ParseResult<RealtimeToolArgumentsByName['delegate_reasoning']> {
  if (!isRecord(raw)) return invalid('Tool arguments must be an object.')
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
