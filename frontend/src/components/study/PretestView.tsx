'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { PretestStartResponse, PretestSubmitResponse } from '@/types'
import { ArrowLeft, ArrowRight, Check, GraduationCap, Target, X } from 'lucide-react'

const LIME = 'text-[#D7FF3D]'
const LIME_BG = 'bg-[#D7FF3D]'

interface PretestViewProps {
  pretest: PretestStartResponse
  onSubmit: (answers: string[]) => Promise<PretestSubmitResponse>
  // Generate the summary (+ quiz) with the missed concepts emphasized and flagged.
  onContinue: (missedConcepts: string[]) => void
  onStartTutor: () => void
  onBack: () => void
  loading: boolean
  progressStage?: string
}

export function PretestView({
  pretest,
  onSubmit,
  onContinue,
  onStartTutor,
  onBack,
  loading,
  progressStage
}: PretestViewProps) {
  const [answers, setAnswers] = useState<Record<number, string>>({})
  const [result, setResult] = useState<PretestSubmitResponse | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const allAnswered = pretest.questions.every((_, i) => answers[i] !== undefined)

  const handleSubmit = async () => {
    if (!allAnswered || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const submitted = await onSubmit(pretest.questions.map((_, i) => answers[i]))
      setResult(submitted)
    } catch {
      setError('Failed to submit the pretest — please try again')
    } finally {
      setSubmitting(false)
    }
  }

  if (result) {
    return (
      <div className="space-y-6">
        {/* Score */}
        <div className="bg-white/[0.06] backdrop-blur-xl rounded-2xl border border-white/15 p-8 text-center">
          <p className="font-serif text-5xl font-light text-white mb-2">
            {result.correct_answers}<span className="text-white/40"> / {result.total_questions}</span>
          </p>
          <p className="text-white/60">
            {result.correct_answers === result.total_questions
              ? 'You already know this material well — the summary will confirm it.'
              : 'Wrong answers here are a feature, not a failure: testing first primes your brain for what you read next.'}
          </p>
        </div>

        {/* Missed concepts */}
        {result.missed_concepts.length > 0 && (
          <div className="rounded-2xl border border-[#D7FF3D]/30 bg-[#D7FF3D]/[0.06] backdrop-blur-xl p-5">
            <div className="flex items-start gap-3">
              <Target className={`h-5 w-5 mt-0.5 shrink-0 ${LIME}`} />
              <div>
                <p className="text-white font-medium font-sans mb-2">Pay extra attention to these as you read</p>
                <div className="flex flex-wrap gap-2">
                  {result.missed_concepts.map(concept => (
                    <span
                      key={concept}
                      className="text-sm px-3 py-1 rounded-full border border-[#D7FF3D]/40 bg-[#D7FF3D]/10 text-white"
                    >
                      {concept}
                    </span>
                  ))}
                </div>
                <p className="text-sm text-white/50 mt-3">
                  These are flagged in the summary, and a tutor session will start already calibrated to them.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Correction */}
        <div className="space-y-4">
          {result.results.map(r => (
            <div
              key={r.question_number}
              className={`rounded-2xl border backdrop-blur-xl p-5 ${
                r.correct ? 'border-white/15 bg-white/[0.04]' : 'border-red-400/30 bg-red-500/[0.06]'
              }`}
            >
              <div className="flex items-start gap-3">
                {r.correct ? (
                  <Check className="h-5 w-5 mt-0.5 shrink-0 text-emerald-300" />
                ) : (
                  <X className="h-5 w-5 mt-0.5 shrink-0 text-red-300" />
                )}
                <div className="min-w-0">
                  <p className="text-white mb-1">{r.question}</p>
                  <p className="text-sm text-white/60">
                    {r.correct ? (
                      <>You answered <span className="text-emerald-300">{r.user_answer}</span></>
                    ) : (
                      <>
                        You answered <span className="text-red-300">{r.user_answer}</span>
                        {' — correct: '}
                        <span className="text-emerald-300">{r.correct_answer}</span>
                      </>
                    )}
                  </p>
                  {!r.correct && r.explanation && (
                    <p className="text-sm text-white/50 mt-2">{r.explanation}</p>
                  )}
                  <p className={`text-xs mt-2 ${LIME}`}>{r.concept}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Next steps */}
        <div className="flex flex-col sm:flex-row justify-end gap-3">
          <Button
            variant="outline"
            onClick={onStartTutor}
            disabled={loading}
            className="border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white"
          >
            <GraduationCap className="h-4 w-4 mr-2" />
            Start a calibrated tutor session
          </Button>
          <Button
            onClick={() => onContinue(result.missed_concepts)}
            disabled={loading}
            className={`${LIME_BG} text-black hover:bg-[#c2e836]`}
          >
            {loading ? (
              <>
                <div className="animate-spin h-4 w-4 mr-2 border-2 border-black/60 border-t-transparent rounded-full" />
                {progressStage || 'Generating...'}
              </>
            ) : (
              <>
                Read the summary
                <ArrowRight className="h-4 w-4 ml-2" />
              </>
            )}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {error && (
        <Alert className="border-red-400/30 bg-red-500/10">
          <X className="h-4 w-4 text-red-300" />
          <AlertDescription className="text-red-200">{error}</AlertDescription>
        </Alert>
      )}

      {pretest.questions.map((q, i) => (
        <div key={q.question_number} className="bg-white/[0.06] backdrop-blur-xl rounded-2xl border border-white/15 p-6">
          <p className="text-sm text-white/40 mb-2">
            Question {q.question_number} of {pretest.total_questions}
          </p>
          <p className="text-lg text-white mb-4">{q.question}</p>
          <div className="grid grid-cols-1 gap-2">
            {q.options.map(option => {
              const selected = answers[i] === option
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setAnswers(prev => ({ ...prev, [i]: option }))}
                  className={`text-left px-4 py-3 rounded-xl border transition-colors ${
                    selected
                      ? 'border-[#D7FF3D]/60 bg-[#D7FF3D]/10 text-white'
                      : 'border-white/15 bg-white/[0.03] text-white/80 hover:border-white/30'
                  }`}
                >
                  {option}
                </button>
              )
            })}
          </div>
        </div>
      ))}

      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          onClick={onBack}
          className="text-white/60 hover:text-white hover:bg-white/10"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={!allAnswered || submitting}
          className={`${LIME_BG} text-black hover:bg-[#c2e836]`}
        >
          {submitting ? (
            <>
              <div className="animate-spin h-4 w-4 mr-2 border-2 border-black/60 border-t-transparent rounded-full" />
              Grading...
            </>
          ) : (
            'Submit answers'
          )}
        </Button>
      </div>
    </div>
  )
}
