export interface SceneEntity {
  id: string
  label?: string
  type?: string
}

export interface LocalCanvasPort {
  getScene(): { elements?: SceneEntity[]; [key: string]: unknown }
  addNode(input: {
    label: string
    x?: number
    y?: number
    kind?: string
    origin?: 'human' | 'ai'
  }): string | Promise<string>
  connectNodes(input: {
    fromId: string
    toId: string
    label?: string
    origin?: 'human' | 'ai'
  }): string | null | Promise<string | null>
  promote(input: { title: string; body: string; elementIds: string[] }): void
}

export interface LocalCollaboratorResult {
  reply: string
  changedElementIds: string[]
}

const wordsAfter = (text: string, marker: RegExp) =>
  text.replace(marker, '').replace(/[.!?]+$/, '').trim()

const findByLabel = (elements: SceneEntity[], phrase: string) => {
  const needle = phrase.toLowerCase().trim()
  return elements.find((element) =>
    element.label?.toLowerCase().includes(needle),
  )
}

export const runLocalCollaborator = async (
  utterance: string,
  canvas: LocalCanvasPort,
): Promise<LocalCollaboratorResult> => {
  const normalized = utterance.toLowerCase().trim()
  const scene = canvas.getScene()
  const elements = scene.elements ?? []

  if (/^(add|create|draw)\s+/.test(normalized)) {
    const label = wordsAfter(
      utterance,
      /^(add|create|draw)\s+(?:(?:an|a|the)\s+)?/i,
    )
    const id = await canvas.addNode({ label: label || 'New idea', origin: 'ai' })
    return {
      reply: `I added “${label || 'New idea'}” as a reversible AI proposal.`,
      changedElementIds: [id],
    }
  }

  const connectMatch = utterance.match(/connect\s+(.+?)\s+to\s+(.+?)(?:[.!?]|$)/i)
  if (connectMatch) {
    const from = findByLabel(elements, connectMatch[1])
    const to = findByLabel(elements, connectMatch[2])
    if (from && to) {
      const id = await canvas.connectNodes({
        fromId: from.id,
        toId: to.id,
        origin: 'ai',
      })
      return {
        reply: `I connected “${from.label}” to “${to.label}”.`,
        changedElementIds: id ? [id] : [],
      }
    }
    return {
      reply: 'I could not find both named ideas. Select or rename them and try again.',
      changedElementIds: [],
    }
  }

  if (/(freeze|promote|accept|document)/.test(normalized)) {
    const selectedIds = Array.isArray(scene.selectedElementIds)
      ? scene.selectedElementIds.filter(
          (id): id is string => typeof id === 'string',
        )
      : []
    const ids =
      selectedIds.length > 0
        ? selectedIds
        : elements.map((element) => element.id).slice(-8)
    canvas.promote({
      title: 'Accepted canvas direction',
      body:
        'The selected canvas structure is accepted as the current design direction. Future work should extend it incrementally rather than regenerate it.',
      elementIds: ids,
    })
    return {
      reply: 'I promoted the current direction into the durable design document with canvas provenance.',
      changedElementIds: ids,
    }
  }

  const centerId = await canvas.addNode({
    label: 'Shared co-thinking session',
    x: 470,
    y: 250,
    kind: 'rectangle',
    origin: 'ai',
  })
  const voiceId = await canvas.addNode({
    label: 'Realtime voice loop',
    x: 180,
    y: 110,
    kind: 'ellipse',
    origin: 'ai',
  })
  const reasoningId = await canvas.addNode({
    label: 'Reasoning delegate',
    x: 760,
    y: 110,
    kind: 'ellipse',
    origin: 'ai',
  })
  await canvas.connectNodes({ fromId: voiceId, toId: centerId, origin: 'ai' })
  await canvas.connectNodes({ fromId: reasoningId, toId: centerId, origin: 'ai' })

  return {
    reply:
      'I mapped a first proposal: the realtime voice loop and the reasoning delegate meet through shared session state. You can move, edit, reject, or promote every element.',
    changedElementIds: [centerId, voiceId, reasoningId],
  }
}
