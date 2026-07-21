import { describe, expect, it, vi } from 'vitest'
import { executeCanvasTool, type CanvasToolService } from './canvasTools'
import type { SceneSummary } from './types'

const scene: SceneSummary = {
  version: 1,
  elementCount: 1,
  nodeCount: 1,
  connectionCount: 0,
  humanElementCount: 1,
  aiElementCount: 0,
  selectedElementIds: ['node-1'],
  elements: [{ id: 'node-1', type: 'rectangle', label: 'Human idea', text: null, origin: 'human', x: 0, y: 0, width: 120, height: 80 }],
  nodes: [{ id: 'node-1', label: 'Human idea', kind: 'rectangle', origin: 'human', x: 0, y: 0, width: 120, height: 80 }],
  connections: [],
}

function service(): CanvasToolService {
  return {
    canvas: {
      addNode: vi.fn().mockReturnValue('ai-node'),
      updateElements: vi.fn().mockReturnValue(['ai-node']),
      groupElements: vi.fn().mockReturnValue(['ai-group']),
      deleteElements: vi.fn().mockReturnValue(['ai-delete']),
      mergeNodes: vi.fn().mockReturnValue('ai-merge'),
      connectNodes: vi.fn(),
      layoutElements: vi.fn().mockReturnValue(['ai-layout']),
      acceptProposals: vi.fn().mockReturnValue([]),
    } as unknown as CanvasToolService['canvas'],
    getScene: () => scene,
    selectedIds: () => ['node-1'],
    addEvent: vi.fn(),
    requestHumanPromotion: vi.fn(),
    delegateReasoning: vi.fn().mockResolvedValue({ ok: true, text: 'Focused result' }),
  }
}

describe('executeCanvasTool', () => {
  it('rejects invalid mutation arguments before touching the canvas', async () => {
    const port = service()
    const result = await executeCanvasTool('add_canvas_node', { label: '' }, port)

    expect(result).toEqual(expect.objectContaining({ ok: false, error: expect.objectContaining({ code: 'INVALID_TOOL_ARGUMENTS' }) }))
    expect(port.canvas?.addNode).not.toHaveBeenCalled()
  })

  it('keeps document promotion as an explicit human action', async () => {
    const port = service()
    const result = await executeCanvasTool('promote_to_document', { nodeIds: ['node-1'], title: 'Suggested title' }, port)

    expect(port.requestHumanPromotion).toHaveBeenCalledWith(['node-1'], 'Suggested title')
    expect(result).toEqual(expect.objectContaining({ ok: false, error: expect.objectContaining({ code: 'HUMAN_ACCEPTANCE_REQUIRED' }) }))
  })

  it('dispatches a validated existing-element update and rejects unknown fields', async () => {
    const port = service()
    const result = await executeCanvasTool('update_canvas_elements', { elementIds: ['node-1'], label: 'Renamed' }, port)

    expect(port.canvas?.updateElements).toHaveBeenCalledWith({ elementIds: ['node-1'], label: 'Renamed', x: undefined, y: undefined, width: undefined, height: undefined })
    expect(result).toEqual(expect.objectContaining({ ok: true, ids: ['ai-node'] }))

    const invalid = await executeCanvasTool('update_canvas_elements', { elementIds: ['node-1'], x: 10, unexpected: true }, port)
    expect(invalid).toEqual(expect.objectContaining({ ok: false, error: expect.objectContaining({ code: 'INVALID_TOOL_ARGUMENTS' }) }))
  })

  it('rejects invalid relationship and layout requests before dispatch', async () => {
    const port = service()
    const selfConnection = await executeCanvasTool('connect_canvas_nodes', { sourceId: 'node-1', targetId: 'node-1' }, port)
    expect(selfConnection).toEqual(expect.objectContaining({ ok: false, error: expect.objectContaining({ code: 'INVALID_CANVAS_REFERENCE' }) }))
    expect(port.canvas?.connectNodes).not.toHaveBeenCalled()

    const invalidLayout = await executeCanvasTool('layout_canvas_elements', { elementIds: ['node-1'], operation: 'align' }, port)
    expect(invalidLayout).toEqual(expect.objectContaining({ ok: false, error: expect.objectContaining({ code: 'INVALID_TOOL_ARGUMENTS' }) }))
    expect(port.canvas?.layoutElements).not.toHaveBeenCalled()
  })

  it('passes a validated reasoning request through without inventing a fallback', async () => {
    const port = service()
    const result = await executeCanvasTool('delegate_reasoning', { prompt: 'Compare options' }, port)

    expect(port.delegateReasoning).toHaveBeenCalledWith({ prompt: 'Compare options', context: undefined })
    expect(result).toEqual({ ok: true, text: 'Focused result' })
  })
})
