import { describe, expect, it } from 'vitest'
import { emptyWorkspace, workspacePersistence, workspaceReducer } from './workspace'

class MemoryStorage implements Storage {
  #values = new Map<string, string>()

  get length(): number { return this.#values.size }
  clear(): void { this.#values.clear() }
  getItem(key: string): string | null { return this.#values.get(key) ?? null }
  key(index: number): string | null { return [...this.#values.keys()][index] ?? null }
  removeItem(key: string): void { this.#values.delete(key) }
  setItem(key: string, value: string): void { this.#values.set(key, value) }
}

describe('workspace persistence', () => {
  it('migrates valid v1 transcript and human sections while dropping incompatible records', () => {
    const storage = new MemoryStorage()
    storage.setItem('cothinker-workspace-v1', JSON.stringify({
      transcript: [{ id: 'line-1', speaker: 'human', text: 'Keep this thought', createdAt: '2026-07-21T00:00:00.000Z' }],
      sections: [
        { id: 'accepted-1', title: 'Accepted', body: 'Kept', elementIds: ['node-1'], createdAt: '2026-07-21T00:00:00.000Z', source: 'human' },
        { id: 'obsolete-1', title: 'Discarded', body: 'Old runtime-only data', elementIds: [], createdAt: '2026-07-21T00:00:00.000Z', source: 'obsolete' },
      ],
    }))

    const migrated = workspacePersistence.load(storage)

    expect(migrated.version).toBe(2)
    expect(migrated.transcript).toHaveLength(1)
    expect(migrated.sections).toEqual([expect.objectContaining({ id: 'accepted-1', source: 'human' })])
    expect(migrated.scene).toBeNull()
    expect(storage.getItem('cothinker-workspace-v1')).toBeNull()
    expect(storage.getItem('cothinker-workspace-v2')).not.toBeNull()
  })

  it('persists a serialized scene and clears every workspace artifact for a new session', () => {
    const state = workspaceReducer(emptyWorkspace(), { type: 'set-scene', scene: JSON.stringify({ elements: [{ id: 'canvas-node' }] }) })
    const selected = workspaceReducer(state, { type: 'set-selection', selectedIds: ['canvas-node'] })
    const cleared = workspaceReducer(selected, { type: 'clear' })

    expect(selected.scene).toContain('canvas-node')
    expect(selected.selectedIds).toEqual(['canvas-node'])
    expect(cleared).toEqual(emptyWorkspace())
  })
})
