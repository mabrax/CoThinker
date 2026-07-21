import { describe, expect, it } from 'vitest'
import { buildMarkdown, type DesignSection } from './domain'

describe('buildMarkdown', () => {
  it('keeps durable sections incremental and traceable', () => {
    const section: DesignSection = {
      id: 'section-1',
      title: 'Voice ownership',
      body: 'The voice agent owns the realtime interaction loop.',
      elementIds: ['voice-node', 'reasoning-node'],
      createdAt: '2026-07-19T00:00:00.000Z',
      source: 'human',
    }

    const markdown = buildMarkdown([section])

    expect(markdown).toContain('## Voice ownership')
    expect(markdown).toContain('voice-node, reasoning-node')
    expect(markdown).toContain('grows only from canvas selections')
  })
})

