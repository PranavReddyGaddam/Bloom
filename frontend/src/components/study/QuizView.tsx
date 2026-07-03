import { Button } from '@/components/ui/button'
import { QuizResponse, UserAnswer } from '@/types'

const LIME_BG = 'bg-[#D7FF3D]'

interface QuizViewProps {
  quiz: QuizResponse
  currentQuestionIndex: number
  setCurrentQuestionIndex: (index: number) => void
  userAnswers: UserAnswer[]
  handleAnswerSelect: (questionIndex: number, selectedOption: string) => void
  handleSubmitQuiz: () => void
  loading: boolean
}

export function QuizView({
  quiz,
  currentQuestionIndex,
  setCurrentQuestionIndex,
  userAnswers,
  handleAnswerSelect,
  handleSubmitQuiz,
  loading
}: QuizViewProps) {
  return (
    <div className="bg-white/[0.06] backdrop-blur-xl rounded-2xl border border-white/15 p-6">
      <div className="space-y-6">
        {/* Question Header */}
        <div className="flex justify-between items-center pb-4 border-b border-white/10">
          <div className="text-sm text-white/50">
            Question {currentQuestionIndex + 1} of {quiz.questions.length}
          </div>
          <div className="text-sm text-white/50">
            {userAnswers.length} of {quiz.questions.length} answered
          </div>
        </div>

        {/* Current Question */}
        {quiz.questions[currentQuestionIndex] && (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-medium text-white leading-relaxed mb-6 font-sans">
                {quiz.questions[currentQuestionIndex].question}
              </h3>

              <div className="space-y-3">
                {quiz.questions[currentQuestionIndex].options.map((option, optionIndex) => (
                  <label
                    key={optionIndex}
                    className="flex items-start space-x-3 p-4 rounded-xl border border-white/15 bg-white/[0.03] hover:bg-white/[0.07] cursor-pointer transition-colors"
                  >
                    <input
                      type="radio"
                      name={`question-${currentQuestionIndex}`}
                      value={option}
                      onChange={() => handleAnswerSelect(currentQuestionIndex, option)}
                      checked={userAnswers.find(a => a.questionIndex === currentQuestionIndex)?.selectedOption === option}
                      className="mt-1 h-4 w-4 accent-[#D7FF3D]"
                    />
                    <span className="text-white/90 leading-relaxed">{option}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Navigation */}
            <div className="flex justify-between items-center pt-6 border-t border-white/10">
              <Button
                variant="outline"
                onClick={() => setCurrentQuestionIndex(Math.max(0, currentQuestionIndex - 1))}
                disabled={currentQuestionIndex === 0}
                className="px-6 border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white"
              >
                Previous
              </Button>

              {currentQuestionIndex === quiz.questions.length - 1 ? (
                <Button
                  onClick={handleSubmitQuiz}
                  disabled={loading || userAnswers.length !== quiz.questions.length}
                  className={`${LIME_BG} text-black hover:bg-[#c2e836] px-8`}
                >
                  {loading ? (
                    <>
                      <div className="animate-spin h-4 w-4 mr-2 border-2 border-black/60 border-t-transparent rounded-full" />
                      Submitting...
                    </>
                  ) : (
                    'Submit Answers'
                  )}
                </Button>
              ) : (
                <Button
                  onClick={() => setCurrentQuestionIndex(Math.min(quiz.questions.length - 1, currentQuestionIndex + 1))}
                  className={`px-6 ${LIME_BG} text-black hover:bg-[#c2e836]`}
                >
                  Next
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
