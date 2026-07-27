'use client'

import { useEffect, useRef } from 'react'
import type { RoleplayTurn } from '@/types'

interface Props {
  transcript: RoleplayTurn[]
  characterName?: string
  // A student turn still being transcribed — shown at reduced opacity because
  // Flux may still revise it. Partials replace rather than append.
  pending?: string | null
  thinking?: boolean
}

export function ConversationLog({
  transcript,
  characterName = 'Them',
  pending,
  thinking,
}: Props) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [transcript.length, pending, thinking])

  return (
    <div className="space-y-4">
      {transcript.map((turn, index) => (
        <div
          key={`${turn.turn_id}-${turn.role}-${index}`}
          className={turn.role === 'student' ? 'flex justify-end' : 'flex justify-start'}
        >
          <div className="max-w-[85%]">
            <div
              className={`text-xs mb-1 ${
                turn.role === 'student' ? 'text-right text-white/40' : 'text-white/40'
              }`}
            >
              {turn.role === 'student' ? 'You' : characterName}
            </div>
            <div
              className={
                turn.role === 'student'
                  ? 'rounded-2xl px-4 py-3 text-sm leading-relaxed bg-[#D7FF3D]/10 border border-[#D7FF3D]/25 text-white'
                  : 'rounded-2xl px-4 py-3 text-sm leading-relaxed bg-white/[0.06] border border-white/15 text-white/90'
              }
            >
              {turn.text}
            </div>
          </div>
        </div>
      ))}

      {pending && (
        <div className="flex justify-end">
          <div className="max-w-[85%]">
            <div className="text-xs mb-1 text-right text-white/40">You</div>
            <div className="rounded-2xl px-4 py-3 text-sm leading-relaxed bg-[#D7FF3D]/5 border border-[#D7FF3D]/15 text-white/50">
              {pending}
            </div>
          </div>
        </div>
      )}

      {thinking && (
        <div className="flex justify-start">
          <div className="rounded-2xl px-4 py-3 bg-white/[0.06] border border-white/15">
            <div className="flex gap-1.5">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-1.5 w-1.5 rounded-full bg-white/40 animate-pulse"
                  style={{ animationDelay: `${i * 150}ms` }}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      <div ref={endRef} />
    </div>
  )
}
