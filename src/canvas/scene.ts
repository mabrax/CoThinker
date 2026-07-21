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
  CanvasGroupInput,
  CanvasLayoutInput,
  CanvasMergeInput,
  CanvasNodeInput,
  CanvasNodeKind,
  CanvasUpdateInput,
  SceneSummary,
} from './types'

const AI_STROKE = '#f08c00'
const AI_BACKGROUND = '#fff4e6'
const AI_TEXT = '#7c2d12'
const HUMAN_STROKE = '#334155'
const HUMAN_BACKGROUND = '#ffffff'

let generatedId = 0

export type CanvasProposalOperation =
  | 'add'
  | 'connect'
  | 'update'
  | 'group'
  | 'delete'
  | 'merge'
  | 'layout'

interface CanvasLineage {
  actionId: string
  operation: CanvasProposalOperation
  sourceIds: string[]
  replaces: string[]
}

interface CanvasProvenance {
  actionId: string
  operation: CanvasProposalOperation
  sourceIds: string[]
  replaces: string[]
}

interface CanvasMarker {
  role: 'node' | 'connection'
  origin: CanvasElementOrigin
  kind?: CanvasNodeKind
  fromId?: string
  toId?: string
  groupId?: string
  groupName?: string
  lineage?: CanvasLineage
  provenance?: CanvasProvenance
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

function nextId(prefix: 'node' | 'connection' | 'text' | 'action' | 'group') {
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
  proposal?: CanvasLineage,
): { id: string; elements: ExcalidrawElement[] } | null {
  if (input.fromId === input.toId) return null
  const from = findElement(currentElements, input.fromId)
  const to = findElement(currentElements, input.toId)

  if (!from || !to || !isNodeShape(from) || !isNodeShape(to)) return null
  const duplicate = currentElements.some((element) => {
    if (element.isDeleted || element.type !== 'arrow') return false
    const marker = markerFor(element)
    return (marker?.fromId ?? element.startBinding?.elementId) === from.id &&
      (marker?.toId ?? element.endBinding?.elementId) === to.id
  })
  if (duplicate) return null

  const id = input.id ?? nextId('connection')
  const origin = normalizeOrigin(input.origin, 'ai')
  const lineage = proposal ?? (origin === 'ai' ? makeLineage('connect', [], []) : undefined)
  const startX = from.x + from.width / 2
  const startY = from.y + from.height / 2
  const endX = to.x + to.width / 2
  const endY = to.y + to.height / 2
  const marker: CanvasMarker = {
    role: 'connection',
    origin,
    fromId: from.id,
    toId: to.id,
    lineage,
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

  const origin = normalizeOrigin(input.origin, 'ai')
  const lineage = origin === 'ai' ? makeLineage('add', [], []) : undefined
  const addedElements = annotateElements([node, ...boundElements], (element) => {
    const marker = markerFor(element)
    return marker ? { ...marker, lineage } : marker
  })

  return {
    id: node.id,
    addedElements,
    elements: [...currentElements, ...addedElements],
  }
}

export function removeAiElements(elements: readonly ExcalidrawElement[]) {
  const removedIds = elements
    .filter((element) => !element.isDeleted && markerFor(element)?.origin === 'ai')
    .map((element) => element.id)
  return removeElementsByIds(elements, removedIds)
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

function makeLineage(
  operation: CanvasProposalOperation,
  sourceIds: readonly string[],
  replaces: readonly string[],
  actionId = nextId('action'),
): CanvasLineage {
  return {
    actionId,
    operation,
    sourceIds: [...new Set(sourceIds)],
    replaces: [...new Set(replaces)],
  }
}

function markerForClone(
  element: ExcalidrawElement,
  lineage: CanvasLineage,
  idMap: ReadonlyMap<string, string>,
  group?: { id: string; name: string },
): CanvasMarker {
  const source = markerFor(element)
  const role: CanvasMarker['role'] = element.type === 'arrow' ? 'connection' : source?.role ?? 'node'
  return {
    role,
    origin: 'ai',
    kind: source?.kind ?? (element.type === 'text' ? undefined : element.type),
    fromId: element.type === 'arrow'
      ? idMap.get(source?.fromId ?? element.startBinding?.elementId ?? '') ?? source?.fromId ?? element.startBinding?.elementId
      : undefined,
    toId: element.type === 'arrow'
      ? idMap.get(source?.toId ?? element.endBinding?.elementId ?? '') ?? source?.toId ?? element.endBinding?.elementId
      : undefined,
    groupId: group?.id ?? source?.groupId,
    groupName: group?.name ?? source?.groupName,
    lineage: makeLineage(lineage.operation, lineage.sourceIds, [element.id], lineage.actionId),
  }
}

function markerForAccepted(
  marker: CanvasMarker,
  lineage: CanvasLineage,
): CanvasMarker {
  const { lineage: _lineage, ...withoutLineage } = marker
  return {
    ...withoutLineage,
    origin: 'human',
    provenance: {
      actionId: lineage.actionId,
      operation: lineage.operation,
      sourceIds: [...lineage.sourceIds],
      replaces: [...lineage.replaces],
    },
  }
}

function applyMarker(
  element: ExcalidrawElement,
  marker: CanvasMarker,
): ExcalidrawElement {
  return newElementWith(element, {
    ...styleForOrigin(marker.origin),
    customData: markerData(marker),
  })
}

function annotateElements(
  elements: readonly ExcalidrawElement[],
  getMarker: (element: ExcalidrawElement) => CanvasMarker | undefined,
) {
  return elements.map((element) => {
    const marker = getMarker(element)
    return marker ? applyMarker(element, marker) : element
  })
}

interface ElementPatch {
  label?: string
  x?: number
  y?: number
  width?: number
  height?: number
  group?: { id: string; name: string }
}

interface CloneResult {
  elements: ExcalidrawElement[]
  rootIds: string[]
  idMap: Map<string, string>
}

function collectCloneIds(
  elements: readonly ExcalidrawElement[],
  rootIds: readonly string[],
  includeConnections: boolean,
): Set<string> {
  const ids = new Set<string>()
  const active = elements.filter((element) => !element.isDeleted)
  for (const rootId of rootIds) {
    const root = active.find((element) => element.id === rootId)
    if (!root) continue
    ids.add(root.id)
    for (const element of active) {
      if (element.type === 'text' && element.containerId === root.id) ids.add(element.id)
    }
  }
  if (includeConnections) {
    for (const element of active) {
      if (element.type !== 'arrow') continue
      const fromId = element.startBinding?.elementId
      const toId = element.endBinding?.elementId
      if (!rootIds.includes(fromId ?? '') && !rootIds.includes(toId ?? '')) continue
      ids.add(element.id)
      for (const candidate of active) {
        if (candidate.type === 'text' && candidate.containerId === element.id) ids.add(candidate.id)
      }
    }
  }
  return ids
}

function cloneForProposal(
  elements: readonly ExcalidrawElement[],
  rootIds: readonly string[],
  lineage: CanvasLineage,
  patches = new Map<string, ElementPatch>(),
  includeConnections = true,
): CloneResult {
  const cloneIds = collectCloneIds(elements, rootIds, includeConnections)
  const originals = elements.filter((element) => !element.isDeleted && cloneIds.has(element.id))
  const idMap = new Map<string, string>()
  for (const original of originals) {
    const prefix = original.type === 'arrow' ? 'connection' : original.type === 'text' ? 'text' : 'node'
    idMap.set(original.id, nextId(prefix))
  }
  const group = [...patches.values()].find((patch) => patch.group)?.group
  const clones = originals.map((original) => {
    const patch = patches.get(original.id) ?? {}
    const marker = markerForClone(original, lineage, idMap, group)
    const updates: Record<string, unknown> = {
      id: idMap.get(original.id),
      index: null,
      isDeleted: false,
      version: original.version + 1,
      versionNonce: generatedId,
      updated: Date.now(),
      groupIds: group ? [group.id] : original.groupIds,
      boundElements: original.boundElements
        ?.map((bound) => ({ ...bound, id: idMap.get(bound.id) ?? bound.id })),
    }
    if (original.type === 'text') {
      updates.containerId = idMap.get(original.containerId ?? '') ?? original.containerId
      const containerId = original.containerId
      const containerPatch = containerId ? patches.get(containerId) : undefined
      if (containerPatch?.label !== undefined) {
        updates.text = containerPatch.label
        updates.originalText = containerPatch.label
      }
    }
    if (original.type === 'arrow') {
      updates.startBinding = remapBinding(original.startBinding, idMap)
      updates.endBinding = remapBinding(original.endBinding, idMap)
    }
    if (original.type !== 'text') {
      for (const field of ['x', 'y', 'width', 'height'] as const) {
        if (patch[field] !== undefined) updates[field] = patch[field]
      }
    }
    return applyMarker({ ...original, ...updates } as ExcalidrawElement, marker)
  })
  let next = [...elements, ...clones]
  const clonedIds = new Set(clones.map((element) => element.id))
  next = syncConnectionGeometry(next, clonedIds)
  next = syncBoundTextPositions(next, clonedIds)
  return {
    elements: next,
    rootIds: rootIds.map((id) => idMap.get(id)).filter((id): id is string => Boolean(id)),
    idMap,
  }
}

function remapBinding(
  binding: { elementId: string; [key: string]: unknown } | null,
  idMap: ReadonlyMap<string, string>,
) {
  return binding ? { ...binding, elementId: idMap.get(binding.elementId) ?? binding.elementId } : binding
}

function syncConnectionGeometry(
  elements: readonly ExcalidrawElement[],
  onlyIds?: ReadonlySet<string>,
) {
  const byId = new Map(elements.filter((element) => !element.isDeleted).map((element) => [element.id, element]))
  return elements.map((element) => {
    if (element.type !== 'arrow' || element.isDeleted || (onlyIds && !onlyIds.has(element.id))) return element
    const from = element.startBinding ? byId.get(element.startBinding.elementId) : undefined
    const to = element.endBinding ? byId.get(element.endBinding.elementId) : undefined
    if (!from || !to || !isNodeShape(from) || !isNodeShape(to)) return element
    const startX = from.x + from.width / 2
    const startY = from.y + from.height / 2
    const endX = to.x + to.width / 2
    const endY = to.y + to.height / 2
    return newElementWith(element, {
      x: startX,
      y: startY,
      width: endX - startX,
      height: endY - startY,
      points: [[0, 0], [endX - startX, endY - startY]] as typeof element.points,
    })
  })
}

function syncBoundTextPositions(
  elements: readonly ExcalidrawElement[],
  onlyIds?: ReadonlySet<string>,
) {
  const byId = new Map(elements.filter((element) => !element.isDeleted).map((element) => [element.id, element]))
  return elements.map((element) => {
    if (element.type !== 'text' || element.isDeleted || !element.containerId || (onlyIds && !onlyIds.has(element.id))) return element
    const container = byId.get(element.containerId)
    if (!container) return element
    return newElementWith(element, {
      x: container.x + (container.width - element.width) / 2,
      y: container.y + (container.height - element.height) / 2,
    })
  })
}

function updateLabel(
  elements: readonly ExcalidrawElement[],
  containerId: string,
  label: string,
) {
  return elements.map((element) => {
    if (element.type !== 'text' || element.containerId !== containerId) return element
    return newElementWith(element, { text: label, originalText: label })
  })
}

function applyDirectUpdate(
  elements: readonly ExcalidrawElement[],
  input: CanvasUpdateInput,
) {
  let next = elements.map((element) => {
    if (element.isDeleted || !input.elementIds.includes(element.id)) return element
    const updates: Record<string, unknown> = {}
    for (const field of ['x', 'y', 'width', 'height'] as const) {
      if (input[field] !== undefined) updates[field] = input[field]
    }
    return Object.keys(updates).length > 0
      ? newElementWith(element, updates as never)
      : element
  })
  if (input.label !== undefined) {
    for (const id of input.elementIds) next = updateLabel(next, id, input.label)
  }
  const changed = new Set(input.elementIds)
  for (const element of next) {
    if (element.type === 'arrow' && (element.startBinding?.elementId && changed.has(element.startBinding.elementId) || element.endBinding?.elementId && changed.has(element.endBinding.elementId))) {
      changed.add(element.id)
    }
  }
  return syncBoundTextPositions(syncConnectionGeometry(next, changed))
}

function removeElementsByIds(
  elements: readonly ExcalidrawElement[],
  ids: readonly string[],
) {
  const removedIds = new Set(ids)
  let changed = true
  while (changed) {
    changed = false
    for (const element of elements) {
      if (removedIds.has(element.id)) {
        for (const bound of element.boundElements ?? []) {
          if (!removedIds.has(bound.id)) {
            removedIds.add(bound.id)
            changed = true
          }
        }
      }
      if (element.type === 'text' && element.containerId && removedIds.has(element.containerId) && !removedIds.has(element.id)) {
        removedIds.add(element.id)
        changed = true
      }
      if (element.type === 'arrow' && !removedIds.has(element.id) && (removedIds.has(element.startBinding?.elementId ?? '') || removedIds.has(element.endBinding?.elementId ?? ''))) {
        removedIds.add(element.id)
        changed = true
      }
    }
  }
  return elements
    .filter((element) => !removedIds.has(element.id))
    .map((element) => {
      const boundElements = element.boundElements?.filter((bound) => !removedIds.has(bound.id))
      return boundElements?.length === element.boundElements?.length
        ? element
        : newElementWith(element, { boundElements })
    })
}

export interface SceneMutation {
  elements: ExcalidrawElement[]
  affectedIds: string[]
}

function activeElementById(elements: readonly ExcalidrawElement[], id: string) {
  return elements.find((element) => !element.isDeleted && element.id === id)
}

function activeMutationRoots(
  elements: readonly ExcalidrawElement[],
  ids: readonly string[],
) {
  return [...new Set(ids)].map((id) => activeElementById(elements, id)).filter(
    (element): element is ExcalidrawElement => element !== undefined && (isNodeShape(element) || element.type === 'arrow'),
  )
}

function hasHumanOrigin(elements: readonly ExcalidrawElement[]) {
  return elements.some((element) => originFor(element) === 'human')
}

export function updateSceneElements(
  elements: readonly ExcalidrawElement[],
  input: CanvasUpdateInput,
): SceneMutation {
  const roots = activeMutationRoots(elements, input.elementIds)
  if (roots.length === 0) return { elements: [...elements], affectedIds: [] }
  const rootIds = roots.map((element) => element.id)
  if (!hasHumanOrigin(roots)) {
    return { elements: applyDirectUpdate(elements, { ...input, elementIds: rootIds }), affectedIds: rootIds }
  }
  const action = makeLineage('update', rootIds, rootIds)
  const patches = new Map(rootIds.map((id) => [id, {
    label: input.label,
    x: input.x,
    y: input.y,
    width: input.width,
    height: input.height,
  } satisfies ElementPatch]))
  const result = cloneForProposal(elements, rootIds, action, patches)
  return { elements: result.elements, affectedIds: result.rootIds }
}

export function groupSceneElements(
  elements: readonly ExcalidrawElement[],
  input: CanvasGroupInput,
): SceneMutation {
  const roots = activeMutationRoots(elements, input.elementIds)
  if (roots.length === 0) return { elements: [...elements], affectedIds: [] }
  const rootIds = roots.map((element) => element.id)
  const group = { id: nextId('group'), name: input.name.trim() }
  if (!hasHumanOrigin(roots)) {
    const groupedIds = collectCloneIds(elements, rootIds, false)
    const next = elements.map((element) => {
      if (element.isDeleted || !groupedIds.has(element.id)) return element
      const marker = markerFor(element)
      if (!marker) return element
      return applyMarker(newElementWith(element, { groupIds: [group.id] }), {
        ...marker,
        groupId: group.id,
        groupName: group.name,
      })
    })
    return { elements: next, affectedIds: rootIds }
  }
  const action = makeLineage('group', rootIds, rootIds)
  const patches = new Map(rootIds.map((id) => [id, { group } satisfies ElementPatch]))
  const result = cloneForProposal(elements, rootIds, action, patches)
  return { elements: result.elements, affectedIds: result.rootIds }
}

export function deleteSceneElements(
  elements: readonly ExcalidrawElement[],
  elementIds: readonly string[],
): SceneMutation {
  const roots = activeMutationRoots(elements, elementIds)
  if (roots.length === 0) return { elements: [...elements], affectedIds: [] }
  const humanRoots = roots.filter((element) => originFor(element) === 'human')
  const aiRoots = roots.filter((element) => originFor(element) === 'ai')
  let next = [...elements]
  if (aiRoots.length > 0) next = removeElementsByIds(next, aiRoots.map((element) => element.id))
  if (humanRoots.length === 0) return { elements: next, affectedIds: aiRoots.map((element) => element.id) }
  const rootIds = humanRoots.map((element) => element.id)
  const action = makeLineage('delete', rootIds, rootIds)
  const result = cloneForProposal(next, rootIds, action, new Map(), false)
  return { elements: result.elements, affectedIds: [...aiRoots.map((element) => element.id), ...result.rootIds] }
}

function containerLabel(elements: readonly ExcalidrawElement[], containerId: string) {
  const label = elements.find((element) => element.type === 'text' && element.containerId === containerId)
  return label?.type === 'text' ? label.text : 'Untitled'
}

function createProposalNode(
  input: CanvasNodeInput,
  lineage: CanvasLineage,
  group?: { id: string; name: string },
) {
  const [node, ...boundElements] = convertToExcalidrawElements([createNodeSkeleton({ ...input, origin: 'ai' })], { regenerateIds: false })
  if (!node) throw new Error('Excalidraw could not create the requested proposal node')
  const marker = {
    role: 'node' as const,
    origin: 'ai' as const,
    kind: input.kind ?? 'rectangle',
    groupId: group?.id,
    groupName: group?.name,
    lineage,
  }
  const next = annotateElements([node, ...boundElements], () => marker)
  return { node: next[0], elements: next }
}

export function mergeSceneNodes(
  elements: readonly ExcalidrawElement[],
  input: CanvasMergeInput,
): SceneMutation {
  const nodes = activeMutationRoots(elements, input.nodeIds).filter(isNodeShape)
  if (nodes.length < 2) return { elements: [...elements], affectedIds: [] }
  const nodeIds = nodes.map((node) => node.id)
  const humanSources = nodes.some((node) => originFor(node) === 'human')
  const action = makeLineage('merge', nodeIds, nodeIds)
  const minX = Math.min(...nodes.map((node) => node.x))
  const minY = Math.min(...nodes.map((node) => node.y))
  const maxX = Math.max(...nodes.map((node) => node.x + node.width))
  const maxY = Math.max(...nodes.map((node) => node.y + node.height))
  const label = input.label?.trim() || nodes.map((node) => containerLabel(elements, node.id)).join(' + ')
  const nodeInput: CanvasNodeInput = {
    label,
    kind: input.kind,
    x: input.x ?? (minX + maxX) / 2 - 100,
    y: input.y ?? (minY + maxY) / 2 - 42,
    origin: 'ai',
  }
  let next = humanSources ? [...elements] : removeElementsByIds(elements, nodeIds)
  const proposal = createProposalNode(nodeInput, action)
  next = [...next, ...proposal.elements]
  const mergedId = proposal.node.id
  const sourceSet = new Set(nodeIds)
  const seenConnections = new Set<string>()
  for (const element of elements) {
    if (element.type !== 'arrow' || !element.startBinding || !element.endBinding) continue
    const fromSelected = sourceSet.has(element.startBinding.elementId)
    const toSelected = sourceSet.has(element.endBinding.elementId)
    if (fromSelected === toSelected) continue
    const externalId = fromSelected ? element.endBinding.elementId : element.startBinding.elementId
    if (seenConnections.has(`${fromSelected ? 'out' : 'in'}:${externalId}`)) continue
    const connection = createConnectionElements(next, {
      fromId: fromSelected ? mergedId : externalId,
      toId: fromSelected ? externalId : mergedId,
      label: containerLabel(elements, element.id),
      origin: 'ai',
    }, makeLineage('merge', nodeIds, [element.id], action.actionId))
    if (!connection) continue
    next = connection.elements
    seenConnections.add(`${fromSelected ? 'out' : 'in'}:${externalId}`)
  }
  if (!humanSources) {
    const proposalIds = next.filter((element) => markerFor(element)?.lineage?.actionId === action.actionId).map((element) => element.id)
    return { elements: next, affectedIds: [mergedId, ...proposalIds.filter((id) => id !== mergedId)] }
  }
  const affectedIds = next.filter((element) => markerFor(element)?.lineage?.actionId === action.actionId && (isNodeShape(element) || element.type === 'arrow')).map((element) => element.id)
  return { elements: next, affectedIds }
}

function layoutPatches(
  nodes: readonly Extract<ExcalidrawElement, { type: 'rectangle' | 'ellipse' | 'diamond' }>[],
  input: CanvasLayoutInput,
) {
  const patches = new Map<string, ElementPatch>()
  if (input.operation === 'snap') {
    const gridSize = input.gridSize ?? 20
    for (const node of nodes) patches.set(node.id, { x: Math.round(node.x / gridSize) * gridSize, y: Math.round(node.y / gridSize) * gridSize })
    return patches
  }
  if (input.operation === 'align') {
    const alignment = input.alignment
    if (!alignment) return patches
    const left = Math.min(...nodes.map((node) => node.x))
    const right = Math.max(...nodes.map((node) => node.x + node.width))
    const top = Math.min(...nodes.map((node) => node.y))
    const bottom = Math.max(...nodes.map((node) => node.y + node.height))
    const centerX = (left + right) / 2
    const centerY = (top + bottom) / 2
    for (const node of nodes) {
      if (alignment === 'left') patches.set(node.id, { x: left })
      if (alignment === 'center') patches.set(node.id, { x: centerX - node.width / 2 })
      if (alignment === 'right') patches.set(node.id, { x: right - node.width })
      if (alignment === 'top') patches.set(node.id, { y: top })
      if (alignment === 'middle') patches.set(node.id, { y: centerY - node.height / 2 })
      if (alignment === 'bottom') patches.set(node.id, { y: bottom - node.height })
    }
    return patches
  }
  const axis = input.axis
  if (!axis) return patches
  const sorted = [...nodes].sort((left, right) => axis === 'horizontal' ? left.x - right.x : left.y - right.y)
  if (sorted.length < 2) return patches
  if (axis === 'horizontal') {
    const start = sorted[0].x
    const end = sorted[sorted.length - 1].x + sorted[sorted.length - 1].width
    const gap = (end - start - sorted.reduce((sum, node) => sum + node.width, 0)) / (sorted.length - 1)
    let position = start
    for (const node of sorted) {
      patches.set(node.id, { x: position })
      position += node.width + gap
    }
  } else {
    const start = sorted[0].y
    const end = sorted[sorted.length - 1].y + sorted[sorted.length - 1].height
    const gap = (end - start - sorted.reduce((sum, node) => sum + node.height, 0)) / (sorted.length - 1)
    let position = start
    for (const node of sorted) {
      patches.set(node.id, { y: position })
      position += node.height + gap
    }
  }
  return patches
}

export function layoutSceneElements(
  elements: readonly ExcalidrawElement[],
  input: CanvasLayoutInput,
): SceneMutation {
  const nodes = activeMutationRoots(elements, input.elementIds).filter(isNodeShape)
  if (nodes.length === 0) return { elements: [...elements], affectedIds: [] }
  const patches = layoutPatches(nodes, input)
  if (patches.size === 0) return { elements: [...elements], affectedIds: [] }
  const nodeIds = nodes.map((node) => node.id)
  if (!hasHumanOrigin(nodes)) {
    let direct: ExcalidrawElement[] = [...elements]
    for (const [id, patch] of patches) direct = applyDirectUpdate(direct, { elementIds: [id], ...patch })
    return { elements: direct, affectedIds: nodeIds }
  }
  const action = makeLineage('layout', nodeIds, nodeIds)
  const result = cloneForProposal(elements, nodeIds, action, patches)
  return { elements: result.elements, affectedIds: result.rootIds }
}

export function acceptProposalElements(
  elements: readonly ExcalidrawElement[],
  selectedIds: readonly string[],
): SceneMutation {
  const active = elements.filter((element) => !element.isDeleted)
  const actionIds = new Set<string>()
  for (const element of active) {
    if (!selectedIds.includes(element.id)) continue
    const actionId = markerFor(element)?.lineage?.actionId
    if (actionId) actionIds.add(actionId)
  }
  if (actionIds.size === 0) return { elements: [...elements], affectedIds: [] }
  let next = [...elements]
  const acceptedIds: string[] = []
  for (const actionId of actionIds) {
    const proposalElements = next.filter((element) => markerFor(element)?.lineage?.actionId === actionId)
    const lineages = proposalElements.map((element) => markerFor(element)?.lineage).filter((lineage): lineage is CanvasLineage => Boolean(lineage))
    const operation = lineages[0]?.operation
    const sourceIds = [...new Set(lineages.flatMap((lineage) => lineage.replaces))]
    const globalLineage = lineages[0]
    if (!globalLineage) continue
    if (operation === 'delete') {
      next = removeElementsByIds(next, [...sourceIds, ...proposalElements.map((element) => element.id)])
      continue
    }
    if (sourceIds.length > 0) next = removeElementsByIds(next, sourceIds)
    const proposalIdSet = new Set(proposalElements.map((element) => element.id))
    next = next.map((element) => {
      if (!proposalIdSet.has(element.id)) return element
      const marker = markerFor(element)
      if (!marker) return element
      if (isNodeShape(element) || element.type === 'arrow') acceptedIds.push(element.id)
      return applyMarker(element, markerForAccepted(marker, globalLineage))
    })
  }
  return { elements: syncBoundTextPositions(syncConnectionGeometry(next)), affectedIds: acceptedIds }
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
      groupId: marker?.groupId,
      groupName: marker?.groupName,
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
    groupId: markerFor(element)?.groupId,
    groupName: markerFor(element)?.groupName,
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
