'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// One AudioContext at 16000 for both directions.
//
// decodeAudioData resamples the 24kHz-native MP3 into the context rate for
// free, so a second context — and with it a second gesture-unlock path — isn't
// needed. Raw PCM was the alternative and it hides a silent-failure trap:
// Aura streams headerless linear16 at 24kHz, and feeding 24kHz samples into a
// 16kHz context plays them 1.5x too slow with no error raised anywhere.
const CONTEXT_SAMPLE_RATE = 16000

export function useRoleplayAudioPlayer() {
  const contextRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const [speaking, setSpeaking] = useState(false)
  const [unlocked, setUnlocked] = useState(false)

  /**
   * Create and resume the AudioContext from inside a user gesture.
   *
   * Must be called from a real click ("Start scene"). Browsers start a context
   * suspended otherwise, and every later play() silently produces nothing —
   * the failure looks exactly like broken audio, with no error to catch.
   */
  const unlock = useCallback(async () => {
    if (!contextRef.current) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext
      contextRef.current = new Ctor({ sampleRate: CONTEXT_SAMPLE_RATE })
    }
    if (contextRef.current.state === 'suspended') {
      await contextRef.current.resume()
    }
    setUnlocked(true)
  }, [])

  /** Cut the character off mid-line (barge-in), or clean up on unmount. */
  const stop = useCallback(() => {
    const source = sourceRef.current
    sourceRef.current = null
    if (source) {
      source.onended = null
      try {
        source.stop()
      } catch {
        // Already stopped; nothing to unwind. Because a turn is decoded only
        // at audio_end, there is no decoder state here either way.
      }
    }
    setSpeaking(false)
  }, [])

  /**
   * Play one turn's audio, given the MP3 frames collected off the socket.
   *
   * The frames are concatenated and decoded exactly once, because the whole
   * clip has already arrived by the time audio_end fires. That is what lets
   * this be a plain decodeAudioData call instead of MediaSource Extensions —
   * no addSourceBuffer, no teardown-and-recreate on barge-in, no Safari
   * capability check, no blob fallback.
   */
  const play = useCallback(async (chunks: ArrayBuffer[]) => {
    const ctx = contextRef.current
    if (!ctx || !chunks.length) return

    const total = chunks.reduce((n, c) => n + c.byteLength, 0)
    const merged = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(new Uint8Array(chunk), offset)
      offset += chunk.byteLength
    }

    let buffer: AudioBuffer
    try {
      // buffer.slice() because decodeAudioData detaches the ArrayBuffer it is
      // handed, which would make the caller's copy unusable on a retry.
      buffer = await ctx.decodeAudioData(merged.buffer.slice(0))
    } catch {
      // A clip that won't decode is a dropped line, not a dropped scene: the
      // text of the reply is already on screen.
      return
    }

    stop()

    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)
    source.onended = () => {
      if (sourceRef.current === source) {
        sourceRef.current = null
        setSpeaking(false)
      }
    }
    sourceRef.current = source
    setSpeaking(true)
    source.start()
  }, [stop])

  useEffect(() => {
    return () => {
      stop()
      void contextRef.current?.close()
      contextRef.current = null
    }
  }, [stop])

  return { play, stop, unlock, speaking, unlocked }
}
