import {
  CaptureUpdateAction,
  Excalidraw,
  serializeAsJSON,
} from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type {
  AppState,
  ExcalidrawImperativeAPI,
} from '@excalidraw/excalidraw/types'
import {
  DEFAULT_CANVAS_SEED,
  appendNode,
  buildSeedElements,
  createConnectionElements,
  removeAiElements,
  sceneFingerprint,
  summarizeScene,
} from '../canvas/scene'
import type {
  CanvasBoardHandle,
  CanvasBoardProps,
  SceneSummary,
} from '../canvas/types'

function selectedIdsFromAppState(appState: AppState) {
  return Object.entries(appState.selectedElementIds)
    .filter(([, isSelected]) => isSelected)
    .map(([id]) => id)
    .sort()
}

function sameIds(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((id, index) => id === right[index])
  )
}

export const CanvasBoard = forwardRef<CanvasBoardHandle, CanvasBoardProps>(
  function CanvasBoard(
    {
      className,
      style,
      initialSeed = DEFAULT_CANVAS_SEED,
      testId = 'canvas-board',
      onSceneChange,
      onSelectionChange,
    },
    ref,
  ) {
    const initialElementsRef = useRef<ExcalidrawElement[] | null>(null)
    if (initialElementsRef.current === null) {
      initialElementsRef.current = buildSeedElements(initialSeed)
    }

    const initialElements = initialElementsRef.current
    const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)
    const elementsRef = useRef<readonly ExcalidrawElement[]>(initialElements)
    const selectedIdsRef = useRef<string[]>([])
    const fingerprintRef = useRef(sceneFingerprint(initialElements))
    const hasPublishedSceneRef = useRef(false)
    const [ready, setReady] = useState(false)
    const [debugSummary, setDebugSummary] = useState<SceneSummary>(() =>
      summarizeScene(initialElements, []),
    )

    const readElements = useCallback((): readonly ExcalidrawElement[] => {
      return apiRef.current?.getSceneElementsIncludingDeleted() ?? elementsRef.current
    }, [])

    const publishScene = useCallback(
      (
        elements: readonly ExcalidrawElement[],
        selectedIds = selectedIdsRef.current,
      ) => {
        elementsRef.current = elements
        fingerprintRef.current = sceneFingerprint(elements)
        hasPublishedSceneRef.current = true
        const summary = summarizeScene(elements, selectedIds)
        setDebugSummary(summary)
        onSceneChange?.(summary)
      },
      [onSceneChange],
    )

    const publishSelection = useCallback(
      (ids: readonly string[]) => {
        const selectedIds = [...ids].sort()
        if (sameIds(selectedIdsRef.current, selectedIds)) return
        selectedIdsRef.current = selectedIds
        setDebugSummary((current) => ({
          ...current,
          selectedElementIds: selectedIds,
        }))
        onSelectionChange?.(selectedIds)
      },
      [onSelectionChange],
    )

    const commitScene = useCallback(
      (
        elements: readonly ExcalidrawElement[],
        selectedElementIds = selectedIdsRef.current,
      ) => {
        const selectedIds = [...selectedElementIds].sort()
        const selectionChanged = !sameIds(selectedIdsRef.current, selectedIds)
        selectedIdsRef.current = selectedIds
        elementsRef.current = elements
        publishScene(elements, selectedIds)
        if (selectionChanged) onSelectionChange?.(selectedIds)
        apiRef.current?.updateScene({
          elements,
          appState: {
            selectedElementIds: Object.fromEntries(
              selectedIds.map((id) => [id, true]),
            ),
          },
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        })
      },
      [onSelectionChange, publishScene],
    )

    const selectElementIds = useCallback(
      (ids: readonly string[], focus = false) => {
        const existingElements = readElements().filter(
          (element) => !element.isDeleted && ids.includes(element.id),
        )
        const selectedIds = existingElements.map((element) => element.id).sort()
        apiRef.current?.updateScene({
          appState: {
            selectedElementIds: Object.fromEntries(
              selectedIds.map((id) => [id, true]),
            ),
          },
          captureUpdate: CaptureUpdateAction.NEVER,
        })
        publishSelection(selectedIds)
        if (focus && existingElements.length > 0) {
          apiRef.current?.scrollToContent(existingElements, {
            fitToContent: true,
            maxZoom: 1.25,
            animate: true,
          })
        }
      },
      [publishSelection, readElements],
    )

    useImperativeHandle(
      ref,
      (): CanvasBoardHandle => ({
        getSceneSummary() {
          const selectedIds = apiRef.current
            ? selectedIdsFromAppState(apiRef.current.getAppState())
            : selectedIdsRef.current
          return summarizeScene(readElements(), selectedIds)
        },
        addNode(input) {
          const result = appendNode(readElements(), input)
          commitScene(result.elements, [result.id])
          apiRef.current?.scrollToContent(result.addedElements, {
            fitToContent: true,
            maxZoom: 1.25,
            animate: true,
          })
          return result.id
        },
        connectNodes(input) {
          const result = createConnectionElements(readElements(), input)
          if (!result) return null
          commitScene(result.elements, [result.id])
          selectElementIds([result.id], true)
          return result.id
        },
        getSelectedElementIds() {
          if (apiRef.current) {
            return selectedIdsFromAppState(apiRef.current.getAppState())
          }
          return [...selectedIdsRef.current]
        },
        selectElementIds(ids) {
          selectElementIds(ids)
        },
        highlightElementIds(ids) {
          selectElementIds(ids, true)
        },
        exportScene() {
          const api = apiRef.current
          return serializeAsJSON(
            readElements(),
            api?.getAppState() ?? {},
            api?.getFiles() ?? {},
            'local',
          )
        },
        clear() {
          commitScene([], [])
        },
        clearAiProposals() {
          commitScene(removeAiElements(readElements()), [])
        },
        reset() {
          commitScene([...initialElements], [])
          apiRef.current?.scrollToContent(initialElements, {
            fitToContent: true,
            maxZoom: 1,
            animate: true,
          })
        },
      }),
      [
        commitScene,
        initialElements,
        readElements,
        selectElementIds,
      ],
    )

    const handleApi = useCallback((api: ExcalidrawImperativeAPI) => {
      apiRef.current = api
      setReady(true)
      if (elementsRef.current !== initialElementsRef.current) {
        api.updateScene({
          elements: elementsRef.current,
          appState: {
            selectedElementIds: Object.fromEntries(
              selectedIdsRef.current.map((id) => [id, true]),
            ),
          },
          captureUpdate: CaptureUpdateAction.NEVER,
        })
      }
    }, [])

    const handleChange = useCallback(
      (elements: readonly ExcalidrawElement[], appState: AppState) => {
        elementsRef.current = elements
        const selectedIds = selectedIdsFromAppState(appState)
        publishSelection(selectedIds)

        const fingerprint = sceneFingerprint(elements)
        if (
          !hasPublishedSceneRef.current ||
          fingerprint !== fingerprintRef.current
        ) {
          publishScene(elements, selectedIds)
        }
      },
      [publishScene, publishSelection],
    )

    return (
      <div
        className={className}
        data-testid={testId}
        data-canvas-ready={ready ? 'true' : 'false'}
        data-scene-version={debugSummary.version}
        data-element-count={debugSummary.elementCount}
        data-node-count={debugSummary.nodeCount}
        data-connection-count={debugSummary.connectionCount}
        data-selected-ids={debugSummary.selectedElementIds.join(',')}
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          minHeight: 420,
          overflow: 'hidden',
          ...style,
        }}
      >
        <Excalidraw
          excalidrawAPI={handleApi}
          initialData={{
            elements: initialElements,
            appState: { viewBackgroundColor: '#f8fafc' },
          }}
          onChange={handleChange}
          autoFocus={false}
          UIOptions={{
            canvasActions: {
              loadScene: false,
              saveToActiveFile: false,
            },
          }}
        />
        <output
          data-testid={`${testId}-debug`}
          hidden
          aria-hidden="true"
        >
          {JSON.stringify(debugSummary)}
        </output>
      </div>
    )
  },
)

CanvasBoard.displayName = 'CanvasBoard'

export type {
  CanvasBoardHandle,
  CanvasBoardProps,
  CanvasConnectionInput,
  CanvasElementSummary,
  CanvasNodeInput,
  SceneSummary,
} from '../canvas/types'

export default CanvasBoard
