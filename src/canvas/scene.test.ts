import { describe, expect, it, vi } from 'vitest'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'

vi.mock('@excalidraw/excalidraw', () => ({
  convertToExcalidrawElements: (skeletons: Array<Record<string, any>>) => skeletons.flatMap((skeleton) => {
    const element = {
      ...baseElement(skeleton),
      ...skeleton,
      boundElements: [],
    } as Record<string, any>
    if (skeleton.label) {
      const text = {
        ...baseElement({}),
        id: `${element.id}-label`,
        type: 'text',
        x: element.x,
        y: element.y,
        width: Math.max(40, element.width - 20),
        height: 28,
        text: skeleton.label.text,
        originalText: skeleton.label.text,
        fontSize: skeleton.label.fontSize ?? 18,
        containerId: element.id,
        customData: skeleton.label.customData,
      }
      element.boundElements = [{ id: text.id, type: 'text' }]
      return [element, text]
    }
    return [element]
  }),
  newElementWith: (element: Record<string, any>, updates: Record<string, any>) => ({
    ...element,
    ...updates,
    version: (element.version ?? 1) + 1,
  }),
  getSceneVersion: (elements: Array<Record<string, any>>) => Math.max(0, ...elements.map((element) => element.version ?? 1)),
}))

function baseElement(input: Record<string, any>) {
  return {
    id: input.id ?? 'generated',
    type: input.type ?? 'text',
    x: input.x ?? 0,
    y: input.y ?? 0,
    width: input.width ?? 100,
    height: input.height ?? 30,
    version: 1,
    versionNonce: 1,
    updated: 1,
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: null,
    startBinding: null,
    endBinding: null,
    points: [[0, 0], [100, 0]],
    customData: input.customData,
  }
}

import {
  acceptProposalElements,
  appendNode,
  createConnectionElements,
  groupSceneElements,
  layoutSceneElements,
  mergeSceneNodes,
  removeAiElements,
  summarizeScene,
  updateSceneElements,
} from './scene'

function humanScene() {
  let elements: ExcalidrawElement[] = []
  elements = appendNode(elements, { id: 'human-a', label: 'Alpha', origin: 'human', x: 10, y: 20 }).elements
  elements = appendNode(elements, { id: 'human-b', label: 'Beta', origin: 'human', x: 360, y: 20 }).elements
  const connection = createConnectionElements(elements, {
    id: 'human-flow',
    fromId: 'human-a',
    toId: 'human-b',
    label: 'leads to',
    origin: 'human',
  })
  if (!connection) throw new Error('test scene connection was not created')
  return connection.elements
}

describe('scene transforms', () => {
  it('keeps a human original untouched while proposing a connected edit', () => {
    const original = humanScene()
    const mutation = updateSceneElements(original, {
      elementIds: ['human-a'],
      label: 'Renamed alpha',
      x: 120,
      y: 180,
      width: 240,
      height: 100,
    })
    const summary = summarizeScene(mutation.elements, mutation.affectedIds)
    const originals = summary.nodes.filter((node) => node.id === 'human-a')
    const proposal = summary.nodes.find((node) => node.origin === 'ai')

    expect(originals).toHaveLength(1)
    expect(originals[0]).toMatchObject({ label: 'Alpha', x: 10, y: 20, width: expect.any(Number) })
    expect(proposal).toMatchObject({ label: 'Renamed alpha', x: 120, y: 180, width: 240, height: 100, origin: 'ai' })
    expect(summary.connections).toHaveLength(2)
    expect(summary.connections.some((connection) => connection.fromId === proposal?.id)).toBe(true)
    expect(summary.elements.find((element) => element.id === proposal?.id)?.customData).toEqual(expect.objectContaining({
      canvasBoard: expect.objectContaining({ lineage: expect.objectContaining({ operation: 'update' }) }),
    }))

    const cleared = summarizeScene(removeAiElements(mutation.elements), [])
    expect(cleared.nodes.map((node) => node.id)).toEqual(['human-a', 'human-b'])
    expect(cleared.connections).toHaveLength(1)
  })

  it('accepts a proposal as a human-owned replacement with durable provenance', () => {
    const mutation = updateSceneElements(humanScene(), { elementIds: ['human-a'], label: 'Accepted alpha', x: 180 })
    const proposal = summarizeScene(mutation.elements, []).nodes.find((node) => node.origin === 'ai')
    if (!proposal) throw new Error('test proposal was not created')

    const accepted = acceptProposalElements(mutation.elements, [proposal.id])
    const summary = summarizeScene(accepted.elements, accepted.affectedIds)
    const node = summary.nodes.find((candidate) => candidate.label === 'Accepted alpha')
    const original = summary.nodes.find((candidate) => candidate.id === 'human-a')

    expect(original).toBeUndefined()
    expect(node).toMatchObject({ origin: 'human', x: 180 })
    expect(accepted.affectedIds).toContain(node?.id)
    expect(summary.elements.find((element) => element.id === node?.id)?.customData).toEqual(expect.objectContaining({
      canvasBoard: expect.objectContaining({
        origin: 'human',
        provenance: expect.objectContaining({ operation: 'update' }),
      }),
    }))
    expect(summary.connections).toHaveLength(1)
    expect(summary.connections[0].fromId).toBe(node?.id)
  })

  it('creates a reversible grid layout proposal for human nodes', () => {
    const mutation = layoutSceneElements(humanScene(), {
      elementIds: ['human-a', 'human-b'],
      operation: 'snap',
      gridSize: 50,
    })
    const summary = summarizeScene(mutation.elements, mutation.affectedIds)
    const proposalNodes = summary.nodes.filter((node) => node.origin === 'ai')

    expect(proposalNodes).toHaveLength(2)
    expect(proposalNodes.every((node) => node.x % 50 === 0 && node.y % 50 === 0)).toBe(true)
    expect(summarizeScene(removeAiElements(mutation.elements), []).nodes).toHaveLength(2)
  })

  it('groups and merges human nodes without taking ownership before acceptance', () => {
    const grouped = groupSceneElements(humanScene(), { elementIds: ['human-a', 'human-b'], name: 'Decision layer' })
    const groupedSummary = summarizeScene(grouped.elements, grouped.affectedIds)
    expect(groupedSummary.nodes.filter((node) => node.origin === 'ai')).toEqual(expect.arrayContaining([
      expect.objectContaining({ groupName: 'Decision layer' }),
    ]))
    expect(groupedSummary.nodes.filter((node) => node.origin === 'human')).toHaveLength(2)

    const merged = mergeSceneNodes(humanScene(), { nodeIds: ['human-a', 'human-b'], label: 'Combined idea' })
    const mergedSummary = summarizeScene(merged.elements, merged.affectedIds)
    const mergedProposal = mergedSummary.nodes.find((node) => node.label === 'Combined idea' && node.origin === 'ai')
    expect(mergedProposal).toBeDefined()
    expect(mergedSummary.nodes.filter((node) => node.origin === 'human')).toHaveLength(2)

    const accepted = acceptProposalElements(merged.elements, mergedProposal ? [mergedProposal.id] : [])
    expect(summarizeScene(accepted.elements, accepted.affectedIds).nodes).toEqual([
      expect.objectContaining({ label: 'Combined idea', origin: 'human' }),
    ])
  })
})
