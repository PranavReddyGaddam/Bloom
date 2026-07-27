'use client'

import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import {
  SummaryResponse, QuizResponse, QuizResult, UserAnswer, FlashcardResponse, StudyOutput,
  PodcastResponse,
} from '@/types'
import {
  ArrowLeft, Brain, ClipboardList, RotateCcw, BookOpen, GraduationCap, Headphones,
} from 'lucide-react'
import { SummaryView } from './SummaryView'
import { QuizView } from './QuizView'
import { QuizResultsView } from './QuizResultsView'
import { FlashcardCarousel } from './FlashcardCarousel'
import { PodcastPlayer } from './PodcastPlayer'

const LIME_BG = 'bg-[#D7FF3D]'

type LessonTab = 'summary' | 'flashcards' | 'quiz' | 'podcast'

const TAB_META: Record<LessonTab, { label: string; icon: React.ReactNode }> = {
  summary: { label: 'Summary', icon: <ClipboardList className="h-4 w-4" /> },
  flashcards: { label: 'Flashcards', icon: <BookOpen className="h-4 w-4" /> },
  quiz: { label: 'Quiz', icon: <Brain className="h-4 w-4" /> },
  podcast: { label: 'Podcast', icon: <Headphones className="h-4 w-4" /> },
}

interface LessonViewProps {
  summary: SummaryResponse | null
  // Concepts missed on a pretest, to flag visually in the summary.
  flaggedConcepts?: string[]
  flashcards: FlashcardResponse | null
  quiz: QuizResponse | null
  podcast: PodcastResponse | null
  quizResult: QuizResult | null
  userAnswers: UserAnswer[]
  currentQuestionIndex: number
  setCurrentQuestionIndex: (index: number) => void
  setQuizResult: (result: QuizResult | null) => void
  setUserAnswers: (answers: UserAnswer[]) => void
  handleAnswerSelect: (questionIndex: number, selectedOption: string) => void
  handleSubmitQuiz: () => void
  loading: boolean
  // Which outputs the student asked for. Drives both the tab list and whether
  // the tutor bar appears; an output that was selected but failed simply has
  // no artifact and so gets no tab.
  outputs: StudyOutput[]
  onStartTutor: () => void
  // Voice roleplay (ROADMAP_HONEN 4). Optional so the lesson renders
  // unchanged wherever the scene isn't offered.
  onStartRoleplay?: () => void
  setCurrentStep: (step: 'upload' | 'tutor' | 'lesson') => void
  resetApp: () => void
}

export function LessonView({
  summary,
  flaggedConcepts,
  flashcards,
  quiz,
  podcast,
  quizResult,
  userAnswers,
  currentQuestionIndex,
  setCurrentQuestionIndex,
  setQuizResult,
  setUserAnswers,
  handleAnswerSelect,
  handleSubmitQuiz,
  loading,
  outputs,
  onStartTutor,
  onStartRoleplay,
  setCurrentStep,
  resetApp
}: LessonViewProps) {
  const router = useRouter()

  // A tab appears only when its output was selected *and* the artifact
  // actually arrived — Promise.allSettled means one failure must not blank the
  // whole screen, so a failed artifact just has no tab.
  // A podcast whose audio failed still counts as arrived: the script is the
  // transcript, and PodcastPlayer renders it as a readable episode. Gating the
  // tab on audio would throw away the expensive half of the generation.
  const available = (['summary', 'flashcards', 'quiz', 'podcast'] as const).filter(tab => {
    if (!outputs.includes(tab)) return false
    if (tab === 'summary') return !!summary
    if (tab === 'flashcards') return !!flashcards
    if (tab === 'podcast') return !!podcast
    return !!quiz
  })

  const showTutorBar = outputs.includes('tutor')

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
                  setCurrentStep('upload')
                  router.push('/upload')
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
        <div className={`space-y-6 mt-6 ${showTutorBar ? 'pb-28' : ''}`}>
          {available.length === 0 ? (
            <div className="bg-white/[0.06] backdrop-blur-xl rounded-2xl border border-white/15 p-8 text-center">
              <p className="text-white font-sans mb-2">Nothing came back</p>
              <p className="text-sm text-white/50">
                None of the selected outputs could be generated. Go back and try again.
              </p>
            </div>
          ) : (
            <Tabs defaultValue={available[0]} className="w-full">
              <TabsList
                className="grid w-full bg-white/5 border border-white/10 backdrop-blur-xl p-1 h-auto rounded-xl"
                style={{ gridTemplateColumns: `repeat(${available.length}, minmax(0, 1fr))` }}
              >
                {available.map(tab => (
                  <TabsTrigger
                    key={tab}
                    value={tab}
                    className="text-white/60 data-[state=active]:bg-white/10 data-[state=active]:text-white data-[state=active]:shadow-none rounded-lg py-2 inline-flex items-center gap-2"
                  >
                    {TAB_META[tab].icon}
                    {TAB_META[tab].label}
                  </TabsTrigger>
                ))}
              </TabsList>

              {available.includes('summary') && (
                <TabsContent value="summary" className="space-y-4">
                  {summary && <SummaryView summary={summary} flaggedConcepts={flaggedConcepts} />}
                </TabsContent>
              )}

              {available.includes('flashcards') && (
                <TabsContent value="flashcards" className="space-y-4">
                  {flashcards && (
                    <div className="bg-white/[0.06] backdrop-blur-xl rounded-2xl border border-white/15 p-6">
                      <div className="mb-6">
                        <h3 className="text-xl font-bold text-white mb-2 font-sans">
                          Your Flashcard Set
                        </h3>
                        <p className="text-sm text-white/60">
                          {flashcards.total_cards} {flashcards.card_type} flashcards • Click to flip
                        </p>
                      </div>
                      <FlashcardCarousel cards={flashcards.flashcards} />
                    </div>
                  )}
                </TabsContent>
              )}

              {available.includes('podcast') && (
                <TabsContent value="podcast" className="space-y-4">
                  {podcast && <PodcastPlayer podcast={podcast} />}
                </TabsContent>
              )}

              {available.includes('quiz') && (
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
              )}
            </Tabs>
          )}
        </div>
      </div>

      {/* Persistent tutor bar — the tutor is a flow, not an artifact, so it's
          offered from the lesson rather than living in a tab. */}
      {showTutorBar && (
        <div className="fixed bottom-0 inset-x-0 z-20 border-t border-white/10 bg-[#0d1230]/80 backdrop-blur-xl">
          <div className="container mx-auto max-w-6xl px-4 py-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <GraduationCap className="h-5 w-5 text-[#D7FF3D] shrink-0" />
              <p className="text-sm text-white/60 truncate">
                Ready to be quizzed on this properly?
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {onStartRoleplay && (
                <Button
                  onClick={onStartRoleplay}
                  disabled={loading}
                  variant="outline"
                  className="border-white/20 text-white/80 hover:bg-white/[0.06]"
                >
                  Explain it out loud
                </Button>
              )}
              <Button
                onClick={onStartTutor}
                disabled={loading}
                className={`${LIME_BG} text-black hover:bg-[#c2e836]`}
              >
                Start tutor session
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
