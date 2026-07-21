import { REALTIME_TOOL_DEFINITIONS } from '../shared/realtimeTools.js'

export const OPENAI_BASE_URL = 'https://api.openai.com/v1'

export const OPENAI_MODELS = {
  realtime: 'gpt-realtime-2.1',
  transcription: 'gpt-4o-mini-transcribe',
  reasoning: 'gpt-5.6-terra',
} as const

export const REALTIME_VOICE = 'marin'

export const REALTIME_INSTRUCTIONS = [
  'Be a concise co-thinking partner for a visual idea canvas.',
  'Help the user clarify, connect, and externalize their thinking; do not take over the thinking.',
  'Speak in short, natural turns and ask at most one useful question at a time.',
  'Use canvas tools when an action or current state is needed, and never claim an action succeeded before its tool result.',
  'Canvas proposals are reversible, including edits to human-owned nodes. Use the manipulation tools for labels, position, size, grouping, deletion, merging, connections, and layout; document promotion is always an explicit human decision.',
  'Use delegate_reasoning only when deeper analysis would materially help.',
].join(' ')

export const REASONING_INSTRUCTIONS =
  'Reason carefully, then return a concise, useful synthesis for a co-thinking canvas.'

export const realtimeSession = {
  type: 'realtime',
  model: OPENAI_MODELS.realtime,
  output_modalities: ['audio'],
  instructions: REALTIME_INSTRUCTIONS,
  audio: {
    input: {
      transcription: { model: OPENAI_MODELS.transcription },
      turn_detection: {
        type: 'semantic_vad',
        eagerness: 'auto',
        create_response: true,
        interrupt_response: true,
      },
    },
    output: { voice: REALTIME_VOICE },
  },
  tools: REALTIME_TOOL_DEFINITIONS,
  tool_choice: 'auto',
} as const

export function openAIApiKey(): string | undefined {
  return process.env.OPENAI_API_KEY?.trim() || undefined
}
