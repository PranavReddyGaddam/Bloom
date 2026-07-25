'use client'

import { Check, Loader2, X } from 'lucide-react'
import { StudyOutput } from '@/types'

const LIME = 'text-[#D7FF3D]'

// Per-artifact state during a fan-out generation. Each selected output runs on
// its own progress id and its own poll loop, so these advance independently —
// which is the whole point of showing a row per artifact rather than one
// shared stage string.
export interface OutputProgress {
  stage: string | null
  status: 'pending' | 'running' | 'done' | 'failed'
  error?: string
}

const LABELS: Record<StudyOutput, string> = {
  summary: 'Summary',
  flashcards: 'Flashcards',
  quiz: 'Quiz',
  pretest: 'Pretest',
  tutor: 'Tutor session',
}

interface GenerationProgressProps {
  outputs: StudyOutput[]
  progress: Partial<Record<StudyOutput, OutputProgress>>
}

export function GenerationProgress({ outputs, progress }: GenerationProgressProps) {
  return (
    <div className="bg-white/[0.06] backdrop-blur-xl rounded-2xl border border-white/15 p-6">
      <ul className="space-y-3" aria-live="polite">
        {outputs.map(output => {
          const state = progress[output] ?? { stage: null, status: 'pending' as const }
          return (
            <li key={output} className="flex items-start gap-3">
              <span className="mt-0.5 shrink-0">
                {state.status === 'done' && <Check className={`h-4 w-4 ${LIME}`} strokeWidth={3} />}
                {state.status === 'failed' && <X className="h-4 w-4 text-red-300" strokeWidth={3} />}
                {state.status === 'running' && (
                  <Loader2 className="h-4 w-4 text-white/60 animate-spin" />
                )}
                {state.status === 'pending' && (
                  <span className="block h-4 w-4 rounded-full border border-white/20" />
                )}
              </span>

              <span className="min-w-0 flex-1">
                <span
                  className={`block font-sans ${
                    state.status === 'pending' ? 'text-white/40' : 'text-white'
                  }`}
                >
                  {LABELS[output]}
                </span>
                <span className="block text-sm text-white/50 mt-0.5">
                  {state.status === 'failed'
                    ? state.error || "Couldn't generate this one"
                    : state.status === 'done'
                      ? 'Ready'
                      : state.stage || (state.status === 'running' ? 'Starting…' : 'Waiting')}
                </span>
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
