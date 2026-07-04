'use client'

import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { api, APIError } from '@/lib/api'
import {
  TutorStartResponse,
  TutorAnswerResponse,
  TutorQuestion,
  ConceptState,
  TutorSessionSummary
} from '@/types'
import { ArrowLeft, Check, X, Lightbulb, GraduationCap, RotateCcw } from 'lucide-react'

const LIME = 'text-[#D7FF3D]'
const LIME_BG = 'bg-[#D7FF3D]'

interface TutorViewProps {
  session: TutorStartResponse
  onExit: () => void
  resetApp: () => void
}

function MasteryBars({ concepts, activeConcept }: { concepts: ConceptState[]; activeConcept?: string }) {
  return (
    <div className="space-y-3">
      {concepts.map(concept => (
        <div key={concept.concept}>
          <div className="flex justify-between items-center mb-1">
            <span className={`text-sm truncate pr-2 ${concept.concept === activeConcept ? 'text-white' : 'text-white/60'}`}>
              {concept.concept}
            </span>
            {concept.mastered ? (
              <span className={`text-xs ${LIME} shrink-0`}>Mastered</span>
            ) : (
              <span className="text-xs text-white/40 shrink-0">
                {concept.questions_correct}/{concept.questions_asked}
              </span>
            )}
          </div>
          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${concept.mastered ? LIME_BG : 'bg-white/40'}`}
              style={{ width: `${Math.round(concept.mastery * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

function SessionSummaryView({ summary, resetApp, onExit }: {
  summary: TutorSessionSummary
  resetApp: () => void
  onExit: () => void
}) {
  return (
    <div className="bg-white/[0.06] backdrop-blur-xl rounded-2xl border border-white/15 p-8">
      <div className="text-center mb-8">
        <GraduationCap className={`h-10 w-10 mx-auto mb-4 ${LIME}`} />
        <h2 className="font-serif text-3xl font-light text-white mb-2">Session complete</h2>
        <p className="text-white/60">
          {summary.correct_answers} of {summary.total_questions} correct · {summary.accuracy}% accuracy
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="rounded-xl border border-[#D7FF3D]/30 bg-[#D7FF3D]/[0.06] p-5">
          <h3 className="text-white font-medium mb-3 font-sans">Concepts mastered</h3>
          {summary.concepts_mastered.length > 0 ? (
            <ul className="space-y-2">
              {summary.concepts_mastered.map(concept => (
                <li key={concept} className="flex items-start gap-2 text-sm text-white/80">
                  <Check className={`h-4 w-4 mt-0.5 shrink-0 ${LIME}`} />
                  {concept}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-white/50">None yet — keep practicing.</p>
          )}
        </div>
        <div className="rounded-xl border border-white/15 bg-white/[0.03] p-5">
          <h3 className="text-white font-medium mb-3 font-sans">Still needs work</h3>
          {summary.concepts_weak.length > 0 ? (
            <ul className="space-y-2">
              {summary.concepts_weak.map(concept => (
                <li key={concept} className="flex items-start gap-2 text-sm text-white/80">
                  <RotateCcw className="h-4 w-4 mt-0.5 shrink-0 text-white/40" />
                  {concept}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-white/50">Nothing — you mastered every concept.</p>
          )}
        </div>
      </div>

      <MasteryBars concepts={summary.concepts} />

      <div className="flex justify-center gap-4 mt-8">
        <Button
          variant="outline"
          onClick={onExit}
          className="border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white"
        >
          Back to study options
        </Button>
        <Button onClick={resetApp} className={`${LIME_BG} text-black hover:bg-[#c2e836]`}>
          Study new material
        </Button>
      </div>
    </div>
  )
}

export function TutorView({ session, onExit, resetApp }: TutorViewProps) {
  const [question, setQuestion] = useState<TutorQuestion>(session.question)
  const [concepts, setConcepts] = useState<ConceptState[]>(session.concepts)
  const [selected, setSelected] = useState<string>('')
  const [feedback, setFeedback] = useState<TutorAnswerResponse | null>(null)
  const [summary, setSummary] = useState<TutorSessionSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = useCallback(async () => {
    if (!selected) return
    setLoading(true)
    setError('')

    try {
      const result = await api.submitTutorAnswer(session.session_id, selected)
      setFeedback(result)
      setConcepts(result.concepts)
    } catch (err) {
      setError(err instanceof APIError ? err.message : 'Failed to submit answer')
    } finally {
      setLoading(false)
    }
  }, [selected, session.session_id])

  const handleNext = useCallback(() => {
    if (!feedback) return
    if (feedback.done && feedback.summary) {
      setSummary(feedback.summary)
    } else if (feedback.next_question) {
      setQuestion(feedback.next_question)
    }
    setFeedback(null)
    setSelected('')
  }, [feedback])

  if (summary) {
    return <SessionSummaryView summary={summary} resetApp={resetApp} onExit={onExit} />
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Question panel */}
      <div className="lg:col-span-2 bg-white/[0.06] backdrop-blur-xl rounded-2xl border border-white/15 p-6">
        <div className="flex justify-between items-center pb-4 border-b border-white/10 mb-6">
          <div className="text-sm text-white/50">
            Question {question.question_number} of up to {session.max_questions}
          </div>
          <div className="text-sm text-white/50">
            <span className="text-white/70">{question.concept}</span> · {question.difficulty}
          </div>
        </div>

        {error && (
          <Alert className="mb-6 border-red-400/30 bg-red-500/10">
            <X className="h-4 w-4 text-red-300" />
            <AlertDescription className="text-red-200">{error}</AlertDescription>
          </Alert>
        )}

        <h3 className="text-lg font-medium text-white leading-relaxed mb-6 font-sans">
          {question.question}
        </h3>

        <div className="space-y-3">
          {question.options.map((option, index) => {
            const isSelected = selected === option
            const isCorrectAnswer = feedback !== null && option === feedback.correct_answer
            const isWrongPick = feedback !== null && isSelected && !feedback.correct

            let optionClasses = 'border-white/15 bg-white/[0.03] hover:bg-white/[0.07]'
            if (feedback !== null) {
              if (isCorrectAnswer) optionClasses = 'border-[#D7FF3D]/60 bg-[#D7FF3D]/10'
              else if (isWrongPick) optionClasses = 'border-red-400/50 bg-red-500/10'
              else optionClasses = 'border-white/10 bg-white/[0.02] opacity-60'
            } else if (isSelected) {
              optionClasses = 'border-[#D7FF3D]/60 bg-[#D7FF3D]/[0.08]'
            }

            return (
              <label
                key={index}
                className={`flex items-start space-x-3 p-4 rounded-xl border transition-colors ${
                  feedback === null ? 'cursor-pointer' : 'cursor-default'
                } ${optionClasses}`}
              >
                <input
                  type="radio"
                  name="tutor-question"
                  value={option}
                  onChange={() => feedback === null && setSelected(option)}
                  checked={isSelected}
                  disabled={feedback !== null}
                  className="mt-1 h-4 w-4 accent-[#D7FF3D]"
                />
                <span className="text-white/90 leading-relaxed flex-1">{option}</span>
                {isCorrectAnswer && <Check className={`h-5 w-5 shrink-0 ${LIME}`} />}
                {isWrongPick && <X className="h-5 w-5 shrink-0 text-red-300" />}
              </label>
            )
          })}
        </div>

        {/* Feedback after answering */}
        {feedback && (
          <div className="mt-6 space-y-3">
            <div className={`rounded-xl border p-4 ${
              feedback.correct
                ? 'border-[#D7FF3D]/30 bg-[#D7FF3D]/[0.06]'
                : 'border-red-400/30 bg-red-500/[0.06]'
            }`}>
              <p className={`font-medium font-sans mb-1 ${feedback.correct ? LIME : 'text-red-300'}`}>
                {feedback.correct ? 'Correct' : 'Not quite'}
              </p>
              {feedback.explanation && (
                <p className="text-sm text-white/70">{feedback.explanation}</p>
              )}
            </div>

            {feedback.diagnosis && (
              <div className="rounded-xl border border-white/15 bg-white/[0.03] p-4">
                <div className="flex items-start gap-3">
                  <Lightbulb className={`h-5 w-5 mt-0.5 shrink-0 ${LIME}`} />
                  <div>
                    <p className="text-white font-medium font-sans mb-1 text-sm">Why you might have picked that</p>
                    <p className="text-sm text-white/70">{feedback.diagnosis}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-between items-center pt-6 mt-6 border-t border-white/10">
          <Button
            variant="ghost"
            onClick={onExit}
            className="text-white/60 hover:text-white hover:bg-white/10"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            End session
          </Button>

          {feedback === null ? (
            <Button
              onClick={handleSubmit}
              disabled={loading || !selected}
              className={`${LIME_BG} text-black hover:bg-[#c2e836] px-8`}
            >
              {loading ? (
                <>
                  <div className="animate-spin h-4 w-4 mr-2 border-2 border-black/60 border-t-transparent rounded-full" />
                  Checking...
                </>
              ) : (
                'Submit Answer'
              )}
            </Button>
          ) : (
            <Button onClick={handleNext} className={`${LIME_BG} text-black hover:bg-[#c2e836] px-8`}>
              {feedback.done ? 'See session summary' : 'Next question'}
            </Button>
          )}
        </div>
      </div>

      {/* Knowledge state panel */}
      <div className="bg-white/[0.06] backdrop-blur-xl rounded-2xl border border-white/15 p-6 h-fit">
        <h3 className="text-white font-medium font-sans mb-1">Your understanding</h3>
        <p className="text-sm text-white/50 mb-5">
          Updated after every answer — the tutor targets your weakest concept next.
        </p>
        <MasteryBars concepts={concepts} activeConcept={question.concept} />
      </div>
    </div>
  )
}
