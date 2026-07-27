'use client'

import { Check, MessageSquare, X } from 'lucide-react'
import type { RoleplayResult } from '@/types'

const LIME = 'text-[#D7FF3D]'
const LIME_BG = 'bg-[#D7FF3D]'

interface Props {
  result: RoleplayResult
  characterName?: string
  onExit?: () => void
  onPracticeAgain?: () => void
}

/**
 * The rubric result and the full transcript.
 *
 * The transcript is shown unconditionally — graded or not. When grading fails
 * the score is null and an honest message says so, rather than an all-met
 * result that would tell a student they demonstrated things they never said.
 */
export function RoleplayResults({
  result,
  characterName = 'Them',
  onExit,
  onPracticeAgain,
}: Props) {
  const met = result.met_count ?? 0
  const total = result.total ?? result.criteria.length

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="bg-white/[0.06] backdrop-blur-xl rounded-2xl border border-white/15 p-8">
        <div className="text-center mb-8">
          <MessageSquare className={`h-10 w-10 mx-auto mb-4 ${LIME}`} />
          <h2 className="font-serif text-3xl font-light text-white mb-2">
            Scene complete
          </h2>
          {result.graded ? (
            <p className="text-white/60">
              {met} of {total} covered
              {typeof result.score === 'number' && ` · ${result.score}%`}
            </p>
          ) : (
            <p className="text-white/60">{result.message}</p>
          )}
        </div>

        {result.summary && (
          <p className="text-sm text-white/70 leading-relaxed mb-8">
            {result.summary}
          </p>
        )}

        {result.criteria.length > 0 && (
          <div className="space-y-4">
            {result.criteria.map((criterion) => (
              <div key={criterion.id}>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-sm text-white/60 pr-2">{criterion.name}</span>
                  {criterion.met ? (
                    <span className={`text-xs shrink-0 flex items-center gap-1 ${LIME}`}>
                      <Check className="h-3 w-3" /> Covered
                    </span>
                  ) : (
                    <span className="text-xs text-white/40 shrink-0 flex items-center gap-1">
                      <X className="h-3 w-3" /> Not covered
                    </span>
                  )}
                </div>
                <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      criterion.met ? LIME_BG : 'bg-white/20'
                    }`}
                    style={{ width: criterion.met ? '100%' : '0%' }}
                  />
                </div>

                {/* The student's own words. This quote is why a criterion can't
                    be marked met on the model's general knowledge of the topic. */}
                {criterion.met && criterion.evidence_quote && (
                  <p className="mt-2 text-xs text-white/50 italic border-l border-[#D7FF3D]/30 pl-3">
                    &ldquo;{criterion.evidence_quote}&rdquo;
                  </p>
                )}
                {!criterion.met && criterion.feedback && (
                  <p className="mt-2 text-xs text-white/40 pl-3">{criterion.feedback}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {(onPracticeAgain || onExit) && (
          <div className="flex gap-3 mt-8 pt-6 border-t border-white/10">
            {onPracticeAgain && (
              <button
                onClick={onPracticeAgain}
                className="flex-1 rounded-xl bg-[#D7FF3D] text-black text-sm font-medium py-3 transition-opacity hover:opacity-90"
              >
                Run another scene
              </button>
            )}
            {onExit && (
              <button
                onClick={onExit}
                className="flex-1 rounded-xl border border-white/20 text-white/80 text-sm py-3 transition-colors hover:bg-white/[0.06]"
              >
                Done
              </button>
            )}
          </div>
        )}
      </div>

      <div className="bg-white/[0.06] backdrop-blur-xl rounded-2xl border border-white/15 p-6">
        <h3 className="text-sm text-white/70 mb-4 pb-4 border-b border-white/10">
          Full transcript
        </h3>
        <div className="space-y-4">
          {result.transcript.map((turn, index) => (
            <div key={`${turn.turn_id}-${turn.role}-${index}`}>
              <div className="text-xs text-white/40 mb-1">
                {turn.role === 'student' ? 'You' : characterName}
              </div>
              <p
                className={`text-sm leading-relaxed ${
                  turn.role === 'student' ? 'text-white' : 'text-white/70'
                }`}
              >
                {turn.text}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
