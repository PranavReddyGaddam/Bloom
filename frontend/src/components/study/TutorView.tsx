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
import { ArrowLeft, Check, X, Lightbulb, GraduationCap, RotateCcw, BookOpen, Flag } from 'lucide-react'
import { MathText } from './MathText'

const LIME = 'text-[#D7FF3D]'
const LIME_BG = 'bg-[#D7FF3D]'

interface TutorViewProps {
  session: TutorStartResponse
  onExit: () => void
  resetApp: () => void
  // Starts a fresh session restricted to the given (weak) concepts.
  onPracticeConcepts?: (concepts: string[]) => Promise<void>
  // Notified when the session ends with a summary (e.g. to clear the
  // resume pointer in sessionStorage).
  onSessionComplete?: () => void
}

type Confidence = 'low' | 'medium' | 'high'

const CONFIDENCE_OPTIONS: { value: Confidence; label: string }[] = [
  { value: 'low', label: 'Not sure' },
  { value: 'medium', label: 'Fairly sure' },
  { value: 'high', label: 'Certain' },
]

// Only shown in the end summary — the live session deliberately exposes no
// per-concept knowledge state.
function MasteryBars({ concepts }: { concepts: ConceptState[] }) {
  return (
    <div className="space-y-3">
      {concepts.map(concept => (
        <div key={concept.concept}>
          <div className="flex justify-between items-center mb-1">
            <span className="text-sm truncate pr-2 text-white/60">
              {concept.concept}
            </span>
            {concept.mastered ? (
              <span className={`text-xs ${LIME} shrink-0`}>Mastered</span>
            ) : concept.parked ? (
              <span className="text-xs text-amber-300/80 shrink-0">Needs a re-read</span>
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

function SessionSummaryView({ summary, resetApp, onExit, onPracticeConcepts }: {
  summary: TutorSessionSummary
  resetApp: () => void
  onExit: () => void
  onPracticeConcepts?: (concepts: string[]) => Promise<void>
}) {
  const [practiceLoading, setPracticeLoading] = useState(false)
  const [practiceError, setPracticeError] = useState('')

  const handlePractice = useCallback(async () => {
    if (!onPracticeConcepts) return
    setPracticeLoading(true)
    setPracticeError('')
    try {
      await onPracticeConcepts(summary.concepts_weak)
    } catch (err) {
      setPracticeError(err instanceof APIError ? err.message : 'Failed to start practice session')
      setPracticeLoading(false)
    }
  }, [onPracticeConcepts, summary.concepts_weak])

  const parked = summary.concepts_parked ?? []

  return (
    <div className="bg-white/[0.06] backdrop-blur-xl rounded-2xl border border-white/15 p-8">
      <div className="text-center mb-8">
        <GraduationCap className={`h-10 w-10 mx-auto mb-4 ${LIME}`} />
        <h2 className="font-serif text-3xl font-light text-white mb-2">Session complete</h2>
        <p className="text-white/60">
          {summary.correct_answers} of {summary.total_questions} correct · {summary.accuracy}% accuracy
        </p>
      </div>

      {/* Compact mastery strip for small screens (ROADMAP 5.5): the full
          per-concept bars sit below the fold under the concept cards, so
          surface a glanceable mini-bar per concept up top. */}
      <div className="md:hidden mb-6">
        <div className="flex gap-1.5">
          {summary.concepts.map(concept => (
            <div
              key={concept.concept}
              title={concept.concept}
              className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden"
            >
              <div
                className={`h-full rounded-full ${
                  concept.mastered ? LIME_BG : concept.parked ? 'bg-amber-300/70' : 'bg-white/40'
                }`}
                style={{ width: `${Math.round(concept.mastery * 100)}%` }}
              />
            </div>
          ))}
        </div>
        <p className="text-xs text-white/40 mt-1.5 text-center">
          {summary.concepts_mastered.length} of {summary.concepts.length} concepts mastered — details below
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

      {parked.length > 0 && (
        <div className="rounded-xl border border-amber-300/30 bg-amber-400/[0.06] p-5 mb-8">
          <h3 className="text-white font-medium mb-2 font-sans flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-amber-300/80" />
            Go back to the material first
          </h3>
          <p className="text-sm text-white/60 mb-3">
            These kept slipping even after corrections — more questions won&apos;t help right now.
            Re-read those sections, then start a new session.
          </p>
          <ul className="space-y-1">
            {parked.map(concept => (
              <li key={concept} className="text-sm text-white/80">{concept}</li>
            ))}
          </ul>
        </div>
      )}

      <MasteryBars concepts={summary.concepts} />

      {practiceError && (
        <Alert className="mt-6 border-red-400/30 bg-red-500/10">
          <X className="h-4 w-4 text-red-300" />
          <AlertDescription className="text-red-200">{practiceError}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap justify-center gap-4 mt-8">
        <Button
          variant="outline"
          onClick={onExit}
          className="border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white"
        >
          Back to study options
        </Button>
        {onPracticeConcepts && summary.concepts_weak.length > 0 && (
          <Button
            onClick={handlePractice}
            disabled={practiceLoading}
            className={`${LIME_BG} text-black hover:bg-[#c2e836]`}
          >
            {practiceLoading ? (
              <>
                <div className="animate-spin h-4 w-4 mr-2 border-2 border-black/60 border-t-transparent rounded-full" />
                Starting...
              </>
            ) : (
              <>
                <RotateCcw className="h-4 w-4 mr-2" />
                Practice these again
              </>
            )}
          </Button>
        )}
        <Button onClick={resetApp} className={`${LIME_BG} text-black hover:bg-[#c2e836]`}>
          Study new material
        </Button>
      </div>
    </div>
  )
}

export function TutorView({ session, onExit, resetApp, onPracticeConcepts, onSessionComplete }: TutorViewProps) {
  const [question, setQuestion] = useState<TutorQuestion>(session.question)
  const [selected, setSelected] = useState<string>('')
  const [textAnswer, setTextAnswer] = useState<string>('')
  const [confidence, setConfidence] = useState<Confidence>('medium')
  const [feedback, setFeedback] = useState<TutorAnswerResponse | null>(null)
  const [summary, setSummary] = useState<TutorSessionSummary | null>(null)
  const [showCheckpoint, setShowCheckpoint] = useState(false)
  const [loading, setLoading] = useState(false)
  const [wrapLoading, setWrapLoading] = useState(false)
  const [error, setError] = useState('')

  // Free-text questions (higher-mastery concepts) take a typed answer
  // instead of a choice; grading happens server-side either way.
  const isFreeText = question.answer_mode === 'free_text'
  const answer = isFreeText ? textAnswer.trim() : selected

  const handleSubmit = useCallback(async () => {
    if (!answer) return
    setLoading(true)
    setError('')

    try {
      const result = await api.submitTutorAnswer(session.session_id, answer, confidence)
      setFeedback(result)
      if (result.checkpoint && !result.done) {
        setShowCheckpoint(true)
      }
    } catch (err) {
      setError(err instanceof APIError ? err.message : 'Failed to submit answer')
    } finally {
      setLoading(false)
    }
  }, [answer, confidence, session.session_id])

  const handleNext = useCallback(() => {
    if (!feedback) return
    if (feedback.done && feedback.summary) {
      setSummary(feedback.summary)
      onSessionComplete?.()
    } else if (feedback.next_question) {
      setQuestion(feedback.next_question)
    }
    setFeedback(null)
    setSelected('')
    setTextAnswer('')
    setConfidence('medium')
    setShowCheckpoint(false)
  }, [feedback, onSessionComplete])

  const handleWrapUp = useCallback(async () => {
    setWrapLoading(true)
    setError('')
    try {
      const result = await api.wrapTutorSession(session.session_id)
      setSummary(result)
      onSessionComplete?.()
    } catch (err) {
      setError(err instanceof APIError ? err.message : 'Failed to wrap up the session')
    } finally {
      setWrapLoading(false)
    }
  }, [session.session_id, onSessionComplete])

  if (summary) {
    return <SessionSummaryView summary={summary} resetApp={resetApp} onExit={onExit} onPracticeConcepts={onPracticeConcepts} />
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="bg-white/[0.06] backdrop-blur-xl rounded-2xl border border-white/15 p-6">
        <div className="flex justify-between items-center pb-4 border-b border-white/10 mb-6">
          <div className="text-sm text-white/50">
            Question {question.question_number}
          </div>
          <div className="text-sm text-white/40">
            Runs until it sticks
          </div>
        </div>

        {error && (
          <Alert className="mb-6 border-red-400/30 bg-red-500/10">
            <X className="h-4 w-4 text-red-300" />
            <AlertDescription className="text-red-200">{error}</AlertDescription>
          </Alert>
        )}

        <h3 className="text-lg font-medium text-white leading-relaxed mb-6 font-sans">
          <MathText text={question.question} />
        </h3>

        {isFreeText ? (
          <div>
            <textarea
              value={textAnswer}
              onChange={(e) => setTextAnswer(e.target.value)}
              disabled={feedback !== null}
              placeholder="Answer in your own words (1-3 sentences)…"
              rows={4}
              className="w-full rounded-xl border border-white/15 bg-white/[0.03] p-4 text-white/90 leading-relaxed placeholder:text-white/30 focus:outline-none focus:border-[#D7FF3D]/60 disabled:opacity-60 resize-y"
            />
            <p className="text-xs text-white/40 mt-2">
              Open-ended question — you&apos;re past recognition on this one, so write the answer yourself.
            </p>
          </div>
        ) : (
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
                <span className="text-white/90 leading-relaxed flex-1"><MathText text={option} /></span>
                {isCorrectAnswer && <Check className={`h-5 w-5 shrink-0 ${LIME}`} />}
                {isWrongPick && <X className="h-5 w-5 shrink-0 text-red-300" />}
              </label>
            )
          })}
        </div>
        )}

        {/* Confidence selector — scales how strongly this answer moves the
            mastery estimate (confidently wrong drops harder). */}
        {feedback === null && (
          <div className="flex flex-wrap items-center gap-3 mt-6">
            <span className="text-sm text-white/50">How sure are you?</span>
            <div className="flex gap-2">
              {CONFIDENCE_OPTIONS.map(option => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setConfidence(option.value)}
                  className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
                    confidence === option.value
                      ? 'border-[#D7FF3D]/60 bg-[#D7FF3D]/10 text-[#D7FF3D]'
                      : 'border-white/15 bg-white/[0.03] text-white/60 hover:bg-white/[0.07]'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Feedback after answering */}
        {feedback && (
          <div className="mt-6 space-y-3">
            <div className={`rounded-xl border p-4 ${
              feedback.correct
                ? 'border-[#D7FF3D]/30 bg-[#D7FF3D]/[0.06]'
                : feedback.verdict === 'partial'
                  ? 'border-amber-300/30 bg-amber-400/[0.06]'
                  : 'border-red-400/30 bg-red-500/[0.06]'
            }`}>
              <p className={`font-medium font-sans mb-1 ${
                feedback.correct ? LIME : feedback.verdict === 'partial' ? 'text-amber-300' : 'text-red-300'
              }`}>
                {feedback.correct ? 'Correct' : feedback.verdict === 'partial' ? 'Partially correct' : 'Not quite'}
              </p>
              {feedback.missing && (
                <p className="text-sm text-white/80 mb-1">
                  What was missing: <MathText text={feedback.missing} />
                </p>
              )}
              {isFreeText && !feedback.correct && (
                <p className="text-sm text-white/80 mb-1">
                  Model answer: <MathText text={feedback.correct_answer} />
                </p>
              )}
              {feedback.explanation && (
                <p className="text-sm text-white/70"><MathText text={feedback.explanation} /></p>
              )}
            </div>

            {feedback.diagnosis && (
              <div className="rounded-xl border border-white/15 bg-white/[0.03] p-4">
                <div className="flex items-start gap-3">
                  <Lightbulb className={`h-5 w-5 mt-0.5 shrink-0 ${LIME}`} />
                  <div>
                    <p className="text-white font-medium font-sans mb-1 text-sm">Why you might have picked that</p>
                    <p className="text-sm text-white/70"><MathText text={feedback.diagnosis} /></p>
                  </div>
                </div>
              </div>
            )}

            {/* One-time soft checkpoint: offer to wrap without forcing it */}
            {showCheckpoint && (
              <div className="rounded-xl border border-white/15 bg-white/[0.03] p-4">
                <div className="flex items-start gap-3">
                  <Flag className={`h-5 w-5 mt-0.5 shrink-0 ${LIME}`} />
                  <div className="flex-1">
                    <p className="text-white font-medium font-sans mb-1 text-sm">You&apos;ve been at this a while</p>
                    <p className="text-sm text-white/70 mb-3">
                      Some concepts still need work — keep going, or wrap up now and see where you stand.
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleWrapUp}
                      disabled={wrapLoading}
                      className="border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white"
                    >
                      {wrapLoading ? 'Wrapping up...' : 'Wrap up & see summary'}
                    </Button>
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
              disabled={loading || !answer}
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
    </div>
  )
}
