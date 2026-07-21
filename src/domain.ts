export type Speaker = 'human' | 'voice' | 'system'

export interface TranscriptEntry {
  id: string
  speaker: Speaker
  text: string
  createdAt: string
  partial?: boolean
}

export interface DesignSection {
  id: string
  title: string
  body: string
  elementIds: string[]
  createdAt: string
  source: 'human' | 'ai'
}

export interface ActivityEvent {
  id: string
  label: string
  detail: string
  createdAt: string
}

export const makeId = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

export const nowIso = () => new Date().toISOString()

export const buildMarkdown = (sections: DesignSection[]) => {
  const preamble = [
    '# Co-thinking design',
    '',
    '> This document grows only from canvas selections that were explicitly promoted.',
    '',
  ]

  if (sections.length === 0) {
    return [...preamble, '_No decisions promoted yet._', ''].join('\n')
  }

  const content = sections.flatMap((section) => [
    `## ${section.title}`,
    '',
    section.body,
    '',
    `<!-- provenance: ${section.elementIds.join(', ')} -->`,
    '',
  ])

  return [...preamble, ...content].join('\n')
}

