'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getAccessToken, wsUrl } from '@/lib/api'
import type { RoleplayResult, RoleplayScenario, RoleplayTurn } from '@/types'

// Framing rule: binary frames are always audio, text frames are always JSON
// control. Direction disambiguates the two binary formats — PCM up, MP3 down —
// so nothing is base64'd.

// Reconnect backoff. Three tries then stop: past that the problem is not
// transient, and silently retrying forever hides a dead backend behind a
// spinner. "Grade what we have" over HTTP is the exit.
const BACKOFF_MS = [1000, 2000, 4000]

export type RoleplayStatus =
  | 'connecting'
  | 'ready'
  | 'thinking'
  | 'speaking'
  | 'graded'
  | 'closed'
  | 'error'

export interface RoleplayNotice {
  code: string
  message: string
  degraded: boolean
}

interface Options {
  sessionId: string
  // Turns already in the transcript when the scene was created (the
  // character's opening line). Replaced wholesale by the server's `ready`.
  initialTranscript?: RoleplayTurn[]
  // Called with each completed turn's MP3 bytes, once audio_end arrives.
  onAudio?: (turnId: number, chunks: ArrayBuffer[]) => void
  enabled?: boolean
}

export function useRoleplaySocket({
  sessionId,
  initialTranscript = [],
  onAudio,
  enabled = true,
}: Options) {
  const [status, setStatus] = useState<RoleplayStatus>('connecting')
  const [scenario, setScenario] = useState<RoleplayScenario | null>(null)
  const [transcript, setTranscript] = useState<RoleplayTurn[]>(initialTranscript)
  const [notice, setNotice] = useState<RoleplayNotice | null>(null)
  const [result, setResult] = useState<RoleplayResult | null>(null)

  const socketRef = useRef<WebSocket | null>(null)
  const attemptRef = useRef(0)
  // Frames accumulate here until audio_end. Keyed by turn so a barge-in can
  // drop one turn's buffer without touching another's.
  const audioRef = useRef<Map<number, ArrayBuffer[]>>(new Map())
  const currentTurnRef = useRef(0)
  // Set when the caller deliberately closes, so the cleanup path doesn't
  // treat an intentional teardown as a dropped connection worth retrying.
  const closingRef = useRef(false)
  const onAudioRef = useRef(onAudio)
  onAudioRef.current = onAudio

  const send = useCallback((payload: Record<string, unknown>) => {
    const socket = socketRef.current
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload))
      return true
    }
    return false
  }, [])

  const connect = useCallback(async () => {
    if (!enabled || !sessionId || closingRef.current) return

    const token = await getAccessToken()
    if (!token) {
      setStatus('error')
      setNotice({
        code: 'unauthenticated',
        message: 'Your session expired. Sign in again to continue.',
        degraded: false,
      })
      return
    }

    const socket = new WebSocket(wsUrl(`/roleplay/live/${sessionId}`))
    socket.binaryType = 'arraybuffer'
    socketRef.current = socket

    socket.onopen = () => {
      // Auth is the first frame, never a query parameter: a token in the URL
      // lands in server access logs and browser history.
      socket.send(JSON.stringify({ type: 'auth', token }))
    }

    socket.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        const turnId = currentTurnRef.current
        const chunks = audioRef.current.get(turnId) ?? []
        chunks.push(event.data)
        audioRef.current.set(turnId, chunks)
        return
      }

      let message: Record<string, unknown>
      try {
        message = JSON.parse(event.data as string)
      } catch {
        return
      }

      switch (message.type) {
        case 'ready': {
          attemptRef.current = 0
          setScenario((message.scenario as RoleplayScenario) ?? null)
          if (Array.isArray(message.transcript)) {
            setTranscript(message.transcript as RoleplayTurn[])
          }
          setStatus('ready')
          break
        }

        case 'thinking': {
          currentTurnRef.current = Number(message.turn_id) || 0
          setStatus('thinking')
          break
        }

        case 'transcript': {
          // Partials REPLACE rather than append: `text` is the whole turn so
          // far, not a delta. Appending would duplicate every word.
          const turnId = Number(message.turn_id) || 0
          const text = String(message.text ?? '')
          const final = Boolean(message.final)
          setTranscript((prev) => {
            const next = [...prev]
            const at = next.findIndex(
              (t) => t.turn_id === turnId && t.role === 'student'
            )
            const turn: RoleplayTurn = { role: 'student', text, turn_id: turnId }
            if (at >= 0) next[at] = turn
            else next.push(turn)
            return next
          })
          if (final) setStatus('thinking')
          break
        }

        case 'reply_text': {
          const turnId = Number(message.turn_id) || 0
          currentTurnRef.current = turnId
          setTranscript((prev) => [
            ...prev,
            { role: 'character', text: String(message.text ?? ''), turn_id: turnId },
          ])
          setStatus('speaking')
          break
        }

        case 'audio_end': {
          // The whole MP3 has arrived. Decoding happens here, once, on a
          // complete buffer — which is why MediaSource Extensions and its
          // frame-alignment problems never enter the picture.
          const turnId = Number(message.turn_id) || 0
          const chunks = audioRef.current.get(turnId)
          audioRef.current.delete(turnId)
          if (chunks?.length) onAudioRef.current?.(turnId, chunks)
          setStatus('ready')
          break
        }

        case 'notice': {
          setNotice({
            code: String(message.code ?? ''),
            message: String(message.message ?? ''),
            degraded: Boolean(message.degraded),
          })
          break
        }

        case 'graded': {
          setResult((message.result as RoleplayResult) ?? null)
          setStatus('graded')
          closingRef.current = true
          break
        }

        case 'error': {
          setNotice({
            code: String(message.code ?? 'internal'),
            message: String(message.message ?? 'Something went wrong.'),
            degraded: false,
          })
          setStatus('error')
          break
        }
      }
    }

    socket.onclose = (event) => {
      socketRef.current = null
      if (closingRef.current) {
        setStatus((s) => (s === 'graded' ? s : 'closed'))
        return
      }

      // 4401/4404 are terminal: retrying a rejected token or a session that
      // isn't ours produces the same answer every time.
      if (event.code === 4401 || event.code === 4404) {
        setStatus('error')
        setNotice({
          code: event.code === 4401 ? 'unauthorized' : 'not_found',
          message:
            event.code === 4401
              ? 'Your session expired. Sign in again to continue.'
              : "This scene isn't available.",
          degraded: false,
        })
        return
      }

      const attempt = attemptRef.current
      if (attempt >= BACKOFF_MS.length) {
        setStatus('error')
        setNotice({
          code: 'disconnected',
          message:
            "We lost the connection and couldn't get it back. You can still " +
            'grade what you have.',
          degraded: true,
        })
        return
      }

      attemptRef.current = attempt + 1
      setStatus('connecting')
      window.setTimeout(() => { void connect() }, BACKOFF_MS[attempt])
    }
  }, [enabled, sessionId])

  useEffect(() => {
    closingRef.current = false
    void connect()
    return () => {
      closingRef.current = true
      socketRef.current?.close()
      socketRef.current = null
    }
  }, [connect])

  const sendUtterance = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      // An empty utterance would produce a confused reply to nothing and
      // still be recorded as if the student had spoken.
      if (!trimmed) return false
      return send({ type: 'utterance', text: trimmed })
    },
    [send]
  )

  // Raw 80ms PCM frames, straight through as binary. No JSON envelope and no
  // base64: the framing rule is that binary is always audio and direction
  // disambiguates the two formats (PCM up, MP3 down).
  const sendAudio = useCallback((pcm: ArrayBuffer) => {
    const socket = socketRef.current
    if (socket?.readyState === WebSocket.OPEN) socket.send(pcm)
  }, [])

  const setMicOpen = useCallback(
    (open: boolean) => send({ type: open ? 'mic_open' : 'mic_close' }),
    [send]
  )

  const bargeIn = useCallback(() => {
    audioRef.current.clear()
    return send({ type: 'barge_in' })
  }, [send])

  const endSession = useCallback(() => {
    closingRef.current = true
    return send({ type: 'end_session' })
  }, [send])

  return {
    status,
    scenario,
    transcript,
    notice,
    result,
    sendUtterance,
    sendAudio,
    setMicOpen,
    bargeIn,
    endSession,
    dismissNotice: useCallback(() => setNotice(null), []),
  }
}
