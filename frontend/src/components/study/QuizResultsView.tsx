import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Check, RotateCcw, X } from 'lucide-react'
import { QuizResponse, QuizResult, UserAnswer, AttemptBreakdown } from '@/types'
import { api } from '@/lib/api'
import { MathText } from './MathText'

const LIME_BG = 'bg-[#D7FF3D]'

interface QuizResultsViewProps {
  quiz: QuizResponse
  quizResult: QuizResult
  userAnswers: UserAnswer[]
  setQuizResult: (result: QuizResult | null) => void
  setUserAnswers: (answers: UserAnswer[]) => void
  setCurrentQuestionIndex: (index: number) => void
  resetApp: () => void
}

export function QuizResultsView({
  quiz,
  quizResult,
  userAnswers,
  setQuizResult,
  setUserAnswers,
  setCurrentQuestionIndex,
  resetApp
}: QuizResultsViewProps) {
  const [reviewIndex, setReviewIndex] = useState(0)
  const [breakdown, setBreakdown] = useState<AttemptBreakdown | null>(null)

  useEffect(() => {
    if (!quizResult.attempt_id) return
    api.getAttemptBreakdown(quizResult.attempt_id)
      .then(setBreakdown)
      .catch(() => setBreakdown(null))
  }, [quizResult.attempt_id])

  const isQuestionCorrect = (questionIndex: number) => {
    const userAnswer = userAnswers.find(a => a.questionIndex === questionIndex)?.selectedOption || ''
    const question = quiz.questions[questionIndex]
    return userAnswer.trim().toLowerCase() === question.correct_answer.trim().toLowerCase()
  }

  const question = quiz.questions[reviewIndex]
  const userAnswer = userAnswers.find(a => a.questionIndex === reviewIndex)?.selectedOption || ''
  const isCorrect = isQuestionCorrect(reviewIndex)

  return (
    <div className="bg-white/[0.06] backdrop-blur-xl rounded-2xl border border-white/15 p-6">
      <div className="space-y-6">
        {/* Performance Summary */}
        <div className="bg-white/5 border border-white/10 p-6 rounded-xl">
          <h3 className="text-xl font-bold text-white mb-6 font-sans">Performance Summary</h3>

          {/* Overall Score */}
          <div className="text-center p-6 bg-white/[0.06] rounded-xl border border-white/10">
            <div className="text-4xl font-bold text-white mb-2">
              {Math.round(quizResult.score)}%
            </div>
            <div className="text-white/60 mb-4">
              {quizResult.correct_answers} out of {quizResult.total_questions} correct answers
            </div>
            <Badge
              variant={quizResult.passed ? "default" : "destructive"}
              className={`text-sm px-4 py-1 ${quizResult.passed ? `${LIME_BG} text-black` : ''}`}
            >
              {quizResult.passed ? "Passed" : "Needs Improvement"}
            </Badge>
          </div>

          {quizResult.suggestion && (
            <div className="mt-4 bg-white/[0.06] p-4 rounded-xl border border-white/10">
              <p className="text-white/70 text-sm leading-relaxed">
                {quizResult.suggestion}
              </p>
            </div>
          )}
        </div>

        {/* Performance by Category / Difficulty (real data, only shown when available) */}
        {breakdown && (breakdown.by_category.length > 0 || breakdown.by_difficulty.length > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {breakdown.by_category.length > 0 && (
              <div className="bg-white/5 border border-white/10 p-6 rounded-xl">
                <h4 className="font-medium text-white mb-4">Performance by Category</h4>
                <div className="space-y-3">
                  {breakdown.by_category.map((entry) => (
                    <div key={entry.label} className="flex justify-between items-center">
                      <span className="text-sm text-white/60 truncate pr-3">{entry.label}</span>
                      <div className="flex-1 mx-3 bg-white/10 rounded-full h-2">
                        <div
                          className={`${LIME_BG} h-2 rounded-full`}
                          style={{ width: `${(entry.correct / entry.total) * 100}%` }}
                        />
                      </div>
                      <span className="text-sm font-medium text-white shrink-0">
                        {entry.correct}/{entry.total}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {breakdown.by_difficulty.length > 0 && (
              <div className="bg-white/5 border border-white/10 p-6 rounded-xl">
                <h4 className="font-medium text-white mb-4">Performance by Difficulty</h4>
                <div className="space-y-3">
                  {breakdown.by_difficulty.map((entry) => (
                    <div key={entry.label} className="flex justify-between items-center">
                      <span className="text-sm text-white/60 capitalize">{entry.label}</span>
                      <div className="flex-1 mx-3 bg-white/10 rounded-full h-2">
                        <div
                          className={`${LIME_BG} h-2 rounded-full`}
                          style={{ width: `${(entry.correct / entry.total) * 100}%` }}
                        />
                      </div>
                      <span className="text-sm font-medium text-white shrink-0">
                        {entry.correct}/{entry.total}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Question Review */}
        <div className="bg-white/5 border border-white/10 p-6 rounded-xl">
          <h4 className="font-medium text-white mb-4">Question Review</h4>

          {/* Question number grid */}
          <div className="flex flex-wrap gap-2 mb-6">
            {quiz.questions.map((_, questionIndex) => {
              const correct = isQuestionCorrect(questionIndex)
              const isActive = questionIndex === reviewIndex

              return (
                <button
                  key={questionIndex}
                  onClick={() => setReviewIndex(questionIndex)}
                  className={`h-9 w-9 rounded-lg text-sm font-medium flex items-center justify-center border-2 transition-colors ${
                    isActive
                      ? 'border-white text-white'
                      : correct
                      ? 'border-transparent bg-[#D7FF3D]/20 text-[#D7FF3D] hover:bg-[#D7FF3D]/30'
                      : 'border-transparent bg-red-500/20 text-red-300 hover:bg-red-500/30'
                  }`}
                >
                  {questionIndex + 1}
                </button>
              )
            })}
          </div>

          {/* Single question detail */}
          <div className={`p-4 rounded-xl border-2 ${
            isCorrect ? 'border-[#D7FF3D]/30 bg-[#D7FF3D]/5' : 'border-red-400/30 bg-red-500/5'
          }`}>
            <div className="flex items-start gap-3 mb-3">
              <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-sm font-medium ${
                isCorrect ? `${LIME_BG} text-black` : 'bg-red-500 text-white'
              }`}>
                {isCorrect ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
              </div>
              <div className="flex-1">
                <h5 className="font-medium text-white mb-2">
                  {reviewIndex + 1}. <MathText text={question.question} />
                </h5>

                <div className="space-y-2 text-sm">
                  <div className={`p-2 rounded-lg ${
                    isCorrect ? 'bg-[#D7FF3D]/10 text-[#D7FF3D]' : 'bg-red-500/10 text-red-300'
                  }`}>
                    <span className="font-medium">Your answer: </span>
                    {userAnswer ? <MathText text={userAnswer} /> : 'No answer selected'}
                  </div>

                  {!isCorrect && (
                    <div className="p-2 rounded-lg bg-[#D7FF3D]/10 text-[#D7FF3D]">
                      <span className="font-medium">Correct answer: </span>
                      <MathText text={question.correct_answer} />
                    </div>
                  )}

                  {question.explanation && (
                    <div className="p-2 rounded-lg bg-white/10 text-white/70">
                      <span className="font-medium">Explanation: </span>
                      <MathText text={question.explanation} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-4">
          <Button
            variant="outline"
            onClick={() => {
              setQuizResult(null)
              setUserAnswers([])
              setCurrentQuestionIndex(0)
            }}
            className="flex-1 border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white"
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Retake Quiz
          </Button>
          <Button onClick={resetApp} className={`flex-1 ${LIME_BG} text-black hover:bg-[#c2e836]`}>
            Create New Quiz
          </Button>
        </div>
      </div>
    </div>
  )
}
