import { useCallback, useEffect, useRef, useState } from 'react'

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number
  results: {
    readonly length: number
    [index: number]: {
      isFinal: boolean
      0: { transcript: string }
    }
  }
}

interface SpeechRecognitionErrorEventLike extends Event {
  error: string
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
}

interface UseBrowserVoiceOptions {
  onFinalTranscript: (text: string) => void | Promise<void>
  onInterimTranscript?: (text: string) => void
}

export const useBrowserVoice = ({
  onFinalTranscript,
  onInterimTranscript,
}: UseBrowserVoiceOptions) => {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const recognitionActiveRef = useRef(false)
  const shouldRestartRef = useRef(false)
  const isSpeakingRef = useRef(false)
  const speechGenerationRef = useRef(0)
  const [isListening, setIsListening] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const supported =
    typeof window !== 'undefined' &&
    Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)

  const stop = useCallback(() => {
    shouldRestartRef.current = false
    recognitionRef.current?.stop()
    setIsListening(false)
  }, [])

  const start = useCallback(() => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!Recognition) {
      setError('Browser speech recognition is not available in this browser.')
      return
    }

    speechGenerationRef.current += 1
    isSpeakingRef.current = false
    window.speechSynthesis?.cancel()
    recognitionRef.current?.abort()
    const recognition = new Recognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'
    recognition.onresult = (event) => {
      let interim = ''
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]
        const text = result[0]?.transcript?.trim()
        if (!text) continue
        if (result.isFinal) void onFinalTranscript(text)
        else interim += `${text} `
      }
      onInterimTranscript?.(interim.trim())
    }
    recognition.onerror = (event) => {
      if (event.error !== 'aborted' && event.error !== 'no-speech') {
        setError(`Microphone recognition error: ${event.error}`)
      }
    }
    recognition.onend = () => {
      recognitionActiveRef.current = false
      if (shouldRestartRef.current && !isSpeakingRef.current) {
        try {
          recognition.start()
          recognitionActiveRef.current = true
        } catch {
          shouldRestartRef.current = false
          setIsListening(false)
        }
      } else if (!isSpeakingRef.current) {
        setIsListening(false)
      }
    }

    recognitionRef.current = recognition
    shouldRestartRef.current = true
    setError(null)
    recognition.start()
    recognitionActiveRef.current = true
    setIsListening(true)
  }, [onFinalTranscript, onInterimTranscript])

  const speak = useCallback((text: string) => {
    if (!('speechSynthesis' in window)) return false
    const generation = speechGenerationRef.current + 1
    speechGenerationRef.current = generation
    isSpeakingRef.current = true
    recognitionRef.current?.stop()
    setIsListening(false)
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = 1.02
    utterance.pitch = 1
    const finishSpeaking = () => {
      if (speechGenerationRef.current !== generation) return
      isSpeakingRef.current = false
      const recognition = recognitionRef.current
      if (
        !shouldRestartRef.current ||
        !recognition ||
        recognitionActiveRef.current
      ) return
      try {
        recognition.start()
        recognitionActiveRef.current = true
        setIsListening(true)
      } catch {
        shouldRestartRef.current = false
        setIsListening(false)
      }
    }
    utterance.onend = finishSpeaking
    utterance.onerror = finishSpeaking
    window.speechSynthesis.speak(utterance)
    return true
  }, [])

  useEffect(
    () => () => {
      shouldRestartRef.current = false
      isSpeakingRef.current = false
      speechGenerationRef.current += 1
      recognitionRef.current?.abort()
      recognitionActiveRef.current = false
      window.speechSynthesis?.cancel()
    },
    [],
  )

  return { supported, isListening, error, start, stop, speak }
}
