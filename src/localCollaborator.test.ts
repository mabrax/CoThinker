import { describe, expect, it, vi } from 'vitest'
import { runLocalCollaborator, type LocalCanvasPort } from './localCollaborator'

const createCanvas = (selectedElementIds: string[] = []): LocalCanvasPort => {
  const elements: Array<{ id: string; label: string; type: string }> = []
  return {
    getScene: () => ({ elements, selectedElementIds }),
    addNode: async ({ label }) => {
      const id = `node-${elements.length + 1}`
      elements.push({ id, label, type: 'rectangle' })
      return id
    },
    connectNodes: async () => 'arrow-1',
    promote: vi.fn(),
  }
}

describe('local collaborator', () => {
  it('turns a spoken add command into a reversible canvas proposal', async () => {
    const canvas = createCanvas()
    const result = await runLocalCollaborator('Add a reasoning agent.', canvas)

    expect(result.changedElementIds).toEqual(['node-1'])
    expect(canvas.getScene().elements?.[0]?.label).toBe('reasoning agent')
    expect(result.reply).toContain('reversible AI proposal')
  })

  it('removes a complete spoken article without clipping the idea', async () => {
    const canvas = createCanvas()
    await runLocalCollaborator('Add an archivist agent.', canvas)

    expect(canvas.getScene().elements?.[0]?.label).toBe('archivist agent')
  })

  it('creates a useful starter architecture for an open-ended prompt', async () => {
    const canvas = createCanvas()
    const result = await runLocalCollaborator('Help me think through this design', canvas)

    expect(result.changedElementIds).toHaveLength(3)
    expect(canvas.getScene().elements).toHaveLength(3)
    expect(result.reply).toContain('shared session state')
  })

  it('promotes the current selection when voice accepts a direction', async () => {
    const canvas = createCanvas(['canvas-selected-1'])
    await runLocalCollaborator('Promote this to the document', canvas)

    expect(canvas.promote).toHaveBeenCalledWith(
      expect.objectContaining({ elementIds: ['canvas-selected-1'] }),
    )
  })
})
