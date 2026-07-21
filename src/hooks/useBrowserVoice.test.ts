// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useBrowserVoice } from './useBrowserVoice'

class FakeSpeechRecognition extends EventTarget {
  static latest: FakeSpeechRecognition | null = null

  continuous = false
  interimResults = false
  lang = ''
  onresult = null
  onerror = null
  onend: (() => void) | null = null
  start = vi.fn()
  stop = vi.fn(() => this.onend?.())
  abort = vi.fn()

  constructor() {
    super()
    FakeSpeechRecognition.latest = this
  }
}

class FakeSpeechUtterance {
  readonly text: string
  rate = 1
  pitch = 1
  onend: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  constructor(text: string) {
    this.text = text
  }
}

afterEach(() => {
  FakeSpeechRecognition.latest = null
  vi.restoreAllMocks()
})

describe('browser voice', () => {
  it('pauses recognition while synthesized speech plays, then resumes it', () => {
    let spoken: FakeSpeechUtterance | null = null
    const cancel = vi.fn()
    const speak = vi.fn((utterance: SpeechSynthesisUtterance) => {
      spoken = utterance as unknown as FakeSpeechUtterance
    })

    Object.defineProperty(window, 'SpeechRecognition', {
      configurable: true,
      value: FakeSpeechRecognition,
    })
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: { cancel, speak },
    })
    Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: FakeSpeechUtterance,
    })

    const { result, unmount } = renderHook(() =>
      useBrowserVoice({ onFinalTranscript: vi.fn() }),
    )

    act(() => result.current.start())
    const recognition = FakeSpeechRecognition.latest
    expect(recognition).not.toBeNull()
    expect(recognition?.start).toHaveBeenCalledTimes(1)

    act(() => {
      expect(result.current.speak('A short reply')).toBe(true)
    })
    expect(recognition?.stop).toHaveBeenCalledTimes(1)
    expect(recognition?.start).toHaveBeenCalledTimes(1)
    expect(result.current.isListening).toBe(false)

    act(() => spoken?.onend?.(new Event('end')))
    expect(recognition?.start).toHaveBeenCalledTimes(2)
    expect(result.current.isListening).toBe(true)

    unmount()
  })
})
