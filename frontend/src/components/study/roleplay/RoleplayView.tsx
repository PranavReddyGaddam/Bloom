'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Keyboard, Send } from 'lucide-react'
import { api } from '@/lib/api'
import { useRoleplaySocket } from '@/hooks/useRoleplaySocket'
import { useRoleplayAudioPlayer } from '@/hooks/useRoleplayAudioPlayer'
import { useAudioRecorder } from '@/hooks/useAudioRecorder'
import type { RoleplayResult, RoleplayStartResponse } from '@/types'
import { ConversationLog } from './ConversationLog'
import { MicOrb } from './MicOrb'
import { RoleplayResults } from './RoleplayResults'
import { ScenarioBrief } from './ScenarioBrief'

// Push-to-talk is the cheapest insurance in the feature: Flux's endpointing is
// good but it does not remove the noisy-room case. Persisted because a student
// who needs it needs it every time.
const PTT_KEY = 'bloom.roleplay.pushToTalk'

interface Props {
  session: RoleplayStartResponse
  onExit?: () => void
  onPracticeAgain?: () => void
}

export function RoleplayView({ session, onExit, onPracticeAgain }: Props) {
  const [started, setStarted] = useState(false)
  const [typed, setTyped] = useState('')
  const [typeMode, setTypeMode] = useState(false)
  const [pushToTalk, setPushToTalk] = useState(false)
  const [talking, setTalking] = useState(false)
  const [httpResult, setHttpResult] = useState<RoleplayResult | null>(null)
  const [grading, setGrading] = useState(false)

  useEffect(() => {
    setPushToTalk(window.localStorage.getItem(PTT_KEY) === '1')
  }, [])

  const player = useRoleplayAudioPlayer()
  const playRef = useRef(player.play)
  playRef.current = player.play

  const handleAudio = useCallback((_turnId: number, chunks: ArrayBuffer[]) => {
    void playRef.current(chunks)
  }, [])

  const socket = useRoleplaySocket({
    sessionId: session.session_id,
    initialTranscript: session.opening_line
      ? [{ role: 'character', text: session.opening_line, turn_id: 0 }]
      : [],
    onAudio: handleAudio,
    enabled: started,
  })

  const scenario = socket.scenario ?? session.scenario
  const characterName = scenario.character?.name ?? 'Them'

  // The echo guard. While the character is speaking, frames are dropped rather
  // than sent — otherwise Flux transcribes the character's own words off the
  // speakers and confidently emits an EndOfTurn for them, triggering a real
  // LLM turn. Barge-in is explicitly opt-in, via the button below.
  const characterSpeaking = player.speaking || socket.status === 'speaking'
  const micMuted = characterSpeaking || (pushToTalk && !talking)

  const socketRef = useRef(socket)
  socketRef.current = socket

  const recorder = useAudioRecorder({
    // Through a ref so the audio graph isn't rebuilt mid-sentence every time
    // the socket hook re-renders.
    onFrame: useCallback((pcm: ArrayBuffer) => {
      socketRef.current.sendAudio(pcm)
    }, []),
    muted: micMuted,
  })

  // mic_open / mic_close are "start/stop sending frames upstream" — a mute
  // button and the push-to-talk gate — not utterance boundaries. Flux keeps
  // its socket either way; only ending the scene closes it.
  useEffect(() => {
    if (started && !typeMode) socket.setMicOpen(!micMuted)
  }, [started, typeMode, micMuted, socket])

  const startScene = useCallback(async () => {
    // Unlock inside the click. A context created outside a gesture starts
    // suspended and every later play() produces silence with no error — the
    // failure is indistinguishable from broken audio.
    await player.unlock()
    setStarted(true)
    const ok = await recorder.start().then(() => true).catch(() => false)
    if (!ok) setTypeMode(true)
  }, [player, recorder])

  // Mic denied or no usable hardware falls back to typing, which is a full
  // path through the scene and the rubric — not an error screen.
  useEffect(() => {
    if (recorder.permission === 'denied' || recorder.permission === 'unavailable') {
      setTypeMode(true)
    }
  }, [recorder.permission])

  // An STT outage gets the same treatment as a denied mic.
  useEffect(() => {
    if (socket.notice?.degraded && socket.notice.code.startsWith('stt')) {
      setTypeMode(true)
    }
  }, [socket.notice])

  const togglePushToTalk = useCallback(() => {
    setPushToTalk((prev) => {
      const next = !prev
      window.localStorage.setItem(PTT_KEY, next ? '1' : '0')
      return next
    })
  }, [])

  const submitTyped = useCallback(() => {
    if (!typed.trim()) return
    socket.sendUtterance(typed)
    setTyped('')
  }, [socket, typed])

  // Grading over HTTP, so a dead socket never costs the student their result.
  const gradeOverHttp = useCallback(async () => {
    setGrading(true)
    try {
      setHttpResult(await api.endRoleplay(session.session_id))
    } catch {
      setHttpResult(null)
    } finally {
      setGrading(false)
    }
  }, [session.session_id])

  const result = socket.result ?? httpResult
  if (result) {
    return (
      <RoleplayResults
        result={result}
        characterName={characterName}
        onExit={onExit}
        onPracticeAgain={onPracticeAgain}
      />
    )
  }

  if (!started) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <ScenarioBrief scenario={scenario} />
        <button
          onClick={startScene}
          className="w-full rounded-xl bg-[#D7FF3D] text-black font-medium py-4 transition-opacity hover:opacity-90"
        >
          Start scene
        </button>
      </div>
    )
  }

  const disconnected = socket.status === 'error'

  return (
    <div className="max-w-5xl mx-auto grid gap-6 lg:grid-cols-[320px_1fr]">
      <div className="lg:sticky lg:top-6 lg:self-start">
        <ScenarioBrief scenario={scenario} />
      </div>

      <div className="space-y-4">
        {socket.notice && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-300/25 bg-amber-300/[0.07] px-4 py-3">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-300/80" />
            <p className="text-sm text-white/70">{socket.notice.message}</p>
          </div>
        )}

        <div className="bg-white/[0.06] backdrop-blur-xl rounded-2xl border border-white/15 p-6">
          <ConversationLog
            transcript={socket.transcript}
            characterName={characterName}
            thinking={socket.status === 'thinking'}
          />
        </div>

        <div className="bg-white/[0.06] backdrop-blur-xl rounded-2xl border border-white/15 p-6">
          {typeMode ? (
            <div className="flex gap-3">
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    submitTyped()
                  }
                }}
                placeholder={`Say something to ${characterName}…`}
                disabled={disconnected || socket.status === 'thinking'}
                className="flex-1 rounded-xl bg-white/[0.06] border border-white/15 px-4 py-3 text-sm text-white placeholder:text-white/30 outline-none focus:border-[#D7FF3D]/40 disabled:opacity-50"
              />
              <button
                onClick={submitTyped}
                disabled={!typed.trim() || disconnected}
                className="rounded-xl bg-[#D7FF3D] text-black px-4 transition-opacity hover:opacity-90 disabled:opacity-40"
                aria-label="Send"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <MicOrb
                level={recorder.level}
                active={recorder.recording}
                muted={micMuted}
                pushToTalk={pushToTalk}
                disabled={disconnected}
                onPointerDown={() => setTalking(true)}
                onPointerUp={() => setTalking(false)}
              />
              {characterSpeaking && (
                <button
                  onClick={() => {
                    player.stop()
                    socket.bargeIn()
                  }}
                  className="text-xs text-white/50 underline underline-offset-4 hover:text-white/80"
                >
                  Interrupt
                </button>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-3 mt-5 pt-4 border-t border-white/10 text-xs">
            <button
              onClick={() => setTypeMode((prev) => !prev)}
              className="flex items-center gap-1.5 text-white/50 hover:text-white/80 transition-colors"
            >
              <Keyboard className="h-3.5 w-3.5" />
              {typeMode ? 'Use the mic' : 'Type instead'}
            </button>

            <div className="flex items-center gap-4">
              {!typeMode && (
                <label className="flex items-center gap-2 text-white/50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pushToTalk}
                    onChange={togglePushToTalk}
                    className="accent-[#D7FF3D]"
                  />
                  Push to talk
                </label>
              )}
              <button
                onClick={disconnected ? gradeOverHttp : () => socket.endSession()}
                disabled={grading}
                className="text-white/50 hover:text-white/80 transition-colors disabled:opacity-40"
              >
                {grading
                  ? 'Grading…'
                  : disconnected
                    ? 'Grade what we have'
                    : 'End scene'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
