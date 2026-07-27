'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// Matches stt_service.SAMPLE_RATE. Flux is opened with
// encoding=linear16&sample_rate=16000, so anything else here arrives as
// audio played at the wrong speed rather than as an error.
const SAMPLE_RATE = 16000
const WORKLET_URL = '/worklets/pcm-recorder.js'

export type MicPermission = 'idle' | 'granted' | 'denied' | 'unavailable'

interface Options {
  // Called with each 80ms Int16 PCM frame, ready to go upstream as-is.
  onFrame: (pcm: ArrayBuffer) => void
  // While true, frames are dropped rather than sent. This is the echo guard:
  // without it the mic hears the character's own TTS and Flux confidently
  // emits an EndOfTurn for it, triggering a real LLM turn on the character's
  // own words. echoCancellation helps but does not close this on speakers.
  muted?: boolean
}

export function useAudioRecorder({ onFrame, muted = false }: Options) {
  const [permission, setPermission] = useState<MicPermission>('idle')
  const [recording, setRecording] = useState(false)
  const [level, setLevel] = useState(0)

  const contextRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const nodeRef = useRef<AudioWorkletNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)

  // Read through refs inside the audio callback so changing either doesn't
  // tear down and rebuild the audio graph mid-sentence.
  const onFrameRef = useRef(onFrame)
  onFrameRef.current = onFrame
  const mutedRef = useRef(muted)
  mutedRef.current = muted

  const stop = useCallback(() => {
    nodeRef.current?.port.close()
    nodeRef.current?.disconnect()
    nodeRef.current = null
    sourceRef.current?.disconnect()
    sourceRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    void contextRef.current?.close()
    contextRef.current = null
    setRecording(false)
    setLevel(0)
  }, [])

  const start = useCallback(async () => {
    if (recording) return

    if (!navigator.mediaDevices?.getUserMedia) {
      setPermission('unavailable')
      return
    }

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // Load-bearing, not a nicety: without it the mic picks up the
          // character's replies from the speakers and the conversation eats
          // itself.
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: SAMPLE_RATE,
        },
      })
    } catch {
      // Denied or no hardware. The caller falls back to type-instead mode,
      // which is a complete path through the feature, not an error screen.
      setPermission('denied')
      return
    }

    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext
    const ctx = new Ctor({ sampleRate: SAMPLE_RATE })

    try {
      await ctx.audioWorklet.addModule(WORKLET_URL)
    } catch {
      stream.getTracks().forEach((track) => track.stop())
      void ctx.close()
      setPermission('unavailable')
      return
    }

    // Safari has historically ignored the sampleRate hint. The worklet frames
    // by sample count, so a different rate would silently produce frames of
    // the wrong duration at the wrong pitch upstream — better to refuse and
    // fall back to typing than to send Flux mis-rated audio.
    if (Math.abs(ctx.sampleRate - SAMPLE_RATE) > 1) {
      stream.getTracks().forEach((track) => track.stop())
      void ctx.close()
      setPermission('unavailable')
      return
    }

    const source = ctx.createMediaStreamSource(stream)
    const node = new AudioWorkletNode(ctx, 'pcm-recorder')

    node.port.onmessage = (event: MessageEvent) => {
      const { pcm, level: frameLevel } = event.data as {
        pcm: ArrayBuffer
        level: number
      }
      setLevel(frameLevel)
      // Frames are dropped, not buffered, while muted: Flux bills streamed
      // audio, and replaying a backlog after unmute would transcribe speech
      // the student meant to keep to themselves.
      if (!mutedRef.current) onFrameRef.current(pcm)
    }

    source.connect(node)
    // Not connected to destination on purpose — routing the mic to the
    // speakers is a feedback loop, and the worklet's output is silent anyway.

    contextRef.current = ctx
    streamRef.current = stream
    nodeRef.current = node
    sourceRef.current = source
    setPermission('granted')
    setRecording(true)
  }, [recording])

  useEffect(() => stop, [stop])

  return { start, stop, recording, level, permission }
}
