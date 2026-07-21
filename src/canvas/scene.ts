import {
  convertToExcalidrawElements,
  getSceneVersion,
  newElementWith,
} from '@excalidraw/excalidraw'
import type { ExcalidrawElementSkeleton } from '@excalidraw/excalidraw/data/transform'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type {
  CanvasConnectionInput,
  CanvasElementOrigin,
  CanvasElementOriginInput,
  CanvasNodeInput,
  CanvasNodeKind,
  SceneSummary,
} from './types'

const AI_STROKE = '#f08c00'
const AI_BACKGROUND = '#fff4e6'
const AI_TEXT = '#7c2d12'
const HUMAN_STROKE = '#334155'
const HUMAN_BACKGROUND = '#ffffff'

let generatedId = 0

interface CanvasMarker {
  role: 'node' | 'connection'
  origin: CanvasElementOrigin
  kind?: CanvasNodeKind
  fromId?: string
  toId?: string
}

export function normalizeOrigin(
  origin: CanvasElementOriginInput | undefined,
  fallback: CanvasElementOrigin,
): CanvasElementOrigin {
  if (origin === 'assistant') return 'ai'
  if (origin === 'user') return 'human'
  return origin ?? fallback
}

export function shapeForKind(
  kind: CanvasNodeKind | undefined,
): 'rectangle' | 'ellipse' | 'diamond' {
  if (kind === 'idea' || kind === 'ellipse') return 'ellipse'
  if (kind === 'decision' || kind === 'diamond') return 'diamond'
  return 'rectangle'
}

function styleForOrigin(origin: CanvasElementOrigin) {
  if (origin === 'ai') {
    return {
      strokeColor: AI_STROKE,
      backgroundColor: AI_BACKGROUND,
      fillStyle: 'solid' as const,
      strokeStyle: 'dashed' as const,
      strokeWidth: 2,
      roughness: 1,
    }
  }

  return {
    strokeColor: HUMAN_STROKE,
    backgroundColor: HUMAN_BACKGROUND,
    fillStyle: 'solid' as const,
    strokeStyle: 'solid' as const,
    strokeWidth: 2,
    roughness: 1,
  }
}

function markerData(marker: CanvasMarker) {
  return { canvasBoard: marker }
}

function labelData(origin: CanvasElementOrigin) {
  return {
    strokeColor: origin === 'ai' ? AI_TEXT : undefined,
    fontSize: 18,
    customData: markerData({ role: 'node', origin }),
  }
}

function nextId(prefix: 'node' | 'connection') {
  generatedId += 1
  const randomPart =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID().slice(0, 8)
      : generatedId.toString(36)
  return `canvas-${prefix}-${randomPart}`
}

export function createNodeSkeleton(
  input: CanvasNodeInput,
  fallbackOrigin: CanvasElementOrigin = 'ai',
): ExcalidrawElementSkeleton {
  const origin = normalizeOrigin(input.origin, fallbackOrigin)
  const kind = input.kind ?? 'rectangle'
  const type = shapeForKind(kind)
  const label = input.label.trim() || 'Untitled'
  const width = Math.min(300, Math.max(type === 'diamond' ? 170 : 160, label.length * 9 + 56))
  const height = type === 'diamond' ? 116 : 84

  return {
    id: input.id ?? nextId('node'),
    type,
    x: input.x ?? 80,
    y: input.y ?? 80,
    width,
    height,
    ...styleForOrigin(origin),
    roundness: type === 'rectangle' ? { type: 3 } : null,
    label: {
      text: label,
      ...labelData(origin),
      customData: markerData({ role: 'node', origin, kind }),
    },
    customData: markerData({ role: 'node', origin, kind }),
  }
}

function findElement(
  elements: readonly ExcalidrawElement[],
  id: string,
) {
  return elements.find((element) => !element.isDeleted && element.id === id)
}

export function createConnectionElements(
  currentElements: readonly ExcalidrawElement[],
  input: CanvasConnectionInput,
): { id: string; elements: ExcalidrawElement[] } | null {
  const from = findElement(currentElements, input.fromId)
  const to = findElement(currentElements, input.toId)

  if (!from || !to || !isNodeShape(from) || !isNodeShape(to)) return null

  const id = input.id ?? nextId('connection')
  const origin = normalizeOrigin(input.origin, 'ai')
  const startX = from.x + from.width / 2
  const startY = from.y + from.height / 2
  const endX = to.x + to.width / 2
  const endY = to.y + to.height / 2
  const marker: CanvasMarker = {
    role: 'connection',
    origin,
    fromId: from.id,
    toId: to.id,
  }
  const label = input.label?.trim()
  const [arrow, ...boundElements] = convertToExcalidrawElements(
    [
      {
        id,
        type: 'arrow',
        x: startX,
        y: startY,
        width: endX - startX,
        height: endY - startY,
        ...styleForOrigin(origin),
        startBinding: { elementId: from.id, focus: 0, gap: 8 },
        endBinding: { elementId: to.id, focus: 0, gap: 8 },
        label: label
          ? {
              text: label,
              fontSize: 16,
              strokeColor: origin === 'ai' ? AI_TEXT : undefined,
              customData: markerData(marker),
            }
          : undefined,
        customData: markerData(marker),
      },
    ],
    { regenerateIds: false },
  )

  if (!arrow) return null

  const nextElements = currentElements.map((element) => {
    if (element.id !== from.id && element.id !== to.id) return element
    if (element.boundElements?.some((bound) => bound.id === id)) return element
    return newElementWith(element, {
      boundElements: [
        ...(element.boundElements ?? []),
        { id, type: 'arrow' },
      ],
    })
  })

  return {
    id,
    elements: [...nextElements, arrow, ...boundElements],
  }
}

export function appendNode(
  currentElements: readonly ExcalidrawElement[],
  input: CanvasNodeInput,
) {
  const existingNodes = currentElements.filter(isNodeShape)
  const defaultX = 80 + (existingNodes.length % 3) * 280
  const defaultY = 80 + Math.floor(existingNodes.length / 3) * 180
  const [node, ...boundElements] = convertToExcalidrawElements(
    [
      createNodeSkeleton({
        ...input,
        x: input.x ?? defaultX,
        y: input.y ?? defaultY,
      }),
    ],
    { regenerateIds: false },
  )

  if (!node) throw new Error('Excalidraw could not create the requested node')

  return {
    id: node.id,
    addedElements: [node, ...boundElements],
    elements: [...currentElements, node, ...boundElements],
  }
}

export function removeAiElements(elements: readonly ExcalidrawElement[]) {
  const removedIds = new Set(
    elements
      .filter((element) => markerFor(element)?.origin === 'ai')
      .map((element) => element.id),
  )

  return elements
    .filter((element) => !removedIds.has(element.id))
    .map((element) => {
      const boundElements = element.boundElements?.filter(
        (bound) => !removedIds.has(bound.id),
      )
      const startWasRemoved =
        element.type === 'arrow' &&
        element.startBinding &&
        removedIds.has(element.startBinding.elementId)
      const endWasRemoved =
        element.type === 'arrow' &&
        element.endBinding &&
        removedIds.has(element.endBinding.elementId)

      if (
        boundElements?.length === element.boundElements?.length &&
        !startWasRemoved &&
        !endWasRemoved
      ) {
        return element
      }

      if (element.type === 'arrow') {
        return newElementWith(element, {
          boundElements,
          startBinding: startWasRemoved ? null : element.startBinding,
          endBinding: endWasRemoved ? null : element.endBinding,
        })
      }

      return newElementWith(element, { boundElements })
    })
}

function isNodeShape(
  element: ExcalidrawElement,
): element is Extract<
  ExcalidrawElement,
  { type: 'rectangle' | 'ellipse' | 'diamond' }
> {
  return (
    !element.isDeleted &&
    (element.type === 'rectangle' ||
      element.type === 'ellipse' ||
      element.type === 'diamond')
  )
}

function markerFor(element: ExcalidrawElement): CanvasMarker | undefined {
  const marker = element.customData?.canvasBoard as
    | Partial<CanvasMarker>
    | undefined
  if (!marker || (marker.role !== 'node' && marker.role !== 'connection')) {
    return undefined
  }
  if (
    marker.origin !== 'human' &&
    marker.origin !== 'ai'
  ) {
    return undefined
  }
  return marker as CanvasMarker
}

function originFor(element: ExcalidrawElement): CanvasElementOrigin {
  return markerFor(element)?.origin ?? 'human'
}

function labelsByContainer(elements: readonly ExcalidrawElement[]) {
  const labels = new Map<string, string>()
  for (const element of elements) {
    if (!element.isDeleted && element.type === 'text' && element.containerId) {
      labels.set(element.containerId, element.text)
    }
  }
  return labels
}

export function sceneFingerprint(elements: readonly ExcalidrawElement[]) {
  return elements
    .map(
      (element) =>
        `${element.id}:${element.version}:${element.isDeleted ? '1' : '0'}`,
    )
    .join('|')
}

export function summarizeScene(
  elements: readonly ExcalidrawElement[],
  selectedElementIds: readonly string[],
): SceneSummary {
  const activeElements = elements.filter((element) => !element.isDeleted)
  const labels = labelsByContainer(activeElements)
  const nodes = activeElements.filter(isNodeShape).map((element) => {
    const marker = markerFor(element)
    return {
      id: element.id,
      label: labels.get(element.id) ?? '',
      kind: marker?.kind ?? element.type,
      origin: originFor(element),
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
    }
  })
  const connections = activeElements
    .filter(
      (
        element,
      ): element is Extract<ExcalidrawElement, { type: 'arrow' }> =>
        element.type === 'arrow',
    )
    .map((element) => {
      const marker = markerFor(element)
      return {
        id: element.id,
        fromId: marker?.fromId ?? element.startBinding?.elementId ?? null,
        toId: marker?.toId ?? element.endBinding?.elementId ?? null,
        label: labels.get(element.id) ?? null,
        origin: originFor(element),
      }
    })
  const summaryElements = activeElements.map((element) => ({
    id: element.id,
    type: element.type,
    label: labels.get(element.id) ?? null,
    text: element.type === 'text' ? element.text : null,
    origin: originFor(element),
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
    customData: element.customData as Record<string, unknown> | undefined,
  }))

  return {
    version: getSceneVersion(activeElements),
    elementCount: activeElements.length,
    nodeCount: nodes.length,
    connectionCount: connections.length,
    humanElementCount: activeElements.filter(
      (element) => originFor(element) === 'human',
    ).length,
    aiElementCount: activeElements.filter(
      (element) => originFor(element) === 'ai',
    ).length,
    selectedElementIds: [...selectedElementIds],
    elements: summaryElements,
    nodes,
    connections,
  }
}
