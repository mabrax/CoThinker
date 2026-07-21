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
      connectNodes: vi.fn(),
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

  it('passes a validated reasoning request through without inventing a fallback', async () => {
    const port = service()
    const result = await executeCanvasTool('delegate_reasoning', { prompt: 'Compare options' }, port)

    expect(port.delegateReasoning).toHaveBeenCalledWith({ prompt: 'Compare options', context: undefined })
    expect(result).toEqual({ ok: true, text: 'Focused result' })
  })
})
