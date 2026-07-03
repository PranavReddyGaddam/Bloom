'use client'

import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import { SummaryResponse, QuizResponse, QuizResult, UserAnswer } from '@/types'
import { ArrowLeft, Brain, ClipboardList, RotateCcw } from 'lucide-react'
import { SummaryView } from './SummaryView'
import { QuizView } from './QuizView'
import { QuizResultsView } from './QuizResultsView'

interface ResultsStepProps {
  summary: SummaryResponse | null
  quiz: QuizResponse | null
  quizResult: QuizResult | null
  userAnswers: UserAnswer[]
  currentQuestionIndex: number
  setCurrentQuestionIndex: (index: number) => void
  setQuizResult: (result: QuizResult | null) => void
  setUserAnswers: (answers: UserAnswer[]) => void
  handleAnswerSelect: (questionIndex: number, selectedOption: string) => void
  handleSubmitQuiz: () => void
  loading: boolean
  setCurrentStep: (step: 'upload' | 'configure' | 'results') => void
  resetApp: () => void
}

export function ResultsStep({
  summary,
  quiz,
  quizResult,
  userAnswers,
  currentQuestionIndex,
  setCurrentQuestionIndex,
  setQuizResult,
  setUserAnswers,
  handleAnswerSelect,
  handleSubmitQuiz,
  loading,
  setCurrentStep,
  resetApp
}: ResultsStepProps) {
  const router = useRouter()

  return (
    <div>
      {/* Header */}
      <header className="relative z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center space-x-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setCurrentStep('configure')
                  router.push('/upload?step=configure')
                }}
                className="text-white/60 hover:text-white hover:bg-white/10"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
            </div>
            <div className="flex items-center space-x-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  resetApp()
                  window.location.reload()
                }}
                className="text-white/60 hover:text-white hover:bg-white/10"
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
              <ProfileAvatar />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="relative z-10 container mx-auto max-w-6xl p-4">
        <div className="space-y-6 mt-6">
          <Tabs defaultValue="summary" className="w-full">
            <TabsList className="grid w-full grid-cols-2 bg-white/5 border border-white/10 backdrop-blur-xl p-1 h-auto rounded-xl">
              <TabsTrigger
                value="summary"
                className="text-white/60 data-[state=active]:bg-white/10 data-[state=active]:text-white data-[state=active]:shadow-none rounded-lg py-2 inline-flex items-center gap-2"
              >
                <ClipboardList className="h-4 w-4" />
                Summary
              </TabsTrigger>
              <TabsTrigger
                value="quiz"
                className="text-white/60 data-[state=active]:bg-white/10 data-[state=active]:text-white data-[state=active]:shadow-none rounded-lg py-2 inline-flex items-center gap-2"
              >
                <Brain className="h-4 w-4" />
                Quiz
              </TabsTrigger>
            </TabsList>

            <TabsContent value="summary" className="space-y-4">
              {summary && <SummaryView summary={summary} />}
            </TabsContent>

            <TabsContent value="quiz" className="space-y-4">
              {quiz && (
                !quizResult ? (
                  <QuizView
                    quiz={quiz}
                    currentQuestionIndex={currentQuestionIndex}
                    setCurrentQuestionIndex={setCurrentQuestionIndex}
                    userAnswers={userAnswers}
                    handleAnswerSelect={handleAnswerSelect}
                    handleSubmitQuiz={handleSubmitQuiz}
                    loading={loading}
                  />
                ) : (
                  <QuizResultsView
                    quiz={quiz}
                    quizResult={quizResult}
                    userAnswers={userAnswers}
                    setQuizResult={setQuizResult}
                    setUserAnswers={setUserAnswers}
                    setCurrentQuestionIndex={setCurrentQuestionIndex}
                    resetApp={resetApp}
                  />
                )
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  )
}
