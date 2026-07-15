'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import { StudyFormData, SummaryType, Difficulty, Subject, FlashcardResponse, SimilarDocument, TutorMode } from '@/types'
import { ArrowLeft, RotateCcw, BookOpen, PencilLine, GraduationCap, X, ArrowRight, History, Target } from 'lucide-react'
import { SubjectSelect } from './SubjectSelect'
import { FlashcardCarousel } from './FlashcardCarousel'

const LIME = 'text-[#D7FF3D]'
const LIME_BG = 'bg-[#D7FF3D]'

type StudyMode = 'flashcards' | 'quiz' | 'tutor' | 'pretest'

interface ConfigureStepProps {
  formData: StudyFormData
  setFormData: React.Dispatch<React.SetStateAction<StudyFormData>>
  loading: boolean
  error: string
  // Live stage of the generation pipeline ("Verifying answers against your
  // material (3 of 10)") — shown in place of the generic loading label.
  progressStage?: string
  similarDocuments: SimilarDocument[]
  flashcards: FlashcardResponse | null
  handleGenerate: () => void
  handleGenerateFlashcards: () => void
  handleStartTutor: () => void
  handleStartPretest: () => void
  // Switches the active material to an overlapping prior upload.
  onOpenDocument: (documentId: string) => Promise<void>
  setCurrentStep: (step: 'upload' | 'configure' | 'results' | 'tutor') => void
  resetApp: () => void
}

export function ConfigureStep({
  formData,
  setFormData,
  loading,
  error,
  progressStage,
  similarDocuments,
  flashcards,
  handleGenerate,
  handleGenerateFlashcards,
  handleStartTutor,
  handleStartPretest,
  onOpenDocument,
  setCurrentStep,
  resetApp
}: ConfigureStepProps) {
  const router = useRouter()
  const [mode, setMode] = useState<StudyMode>('flashcards')
  const [similarDismissed, setSimilarDismissed] = useState(false)
  const [openingDocId, setOpeningDocId] = useState<string | null>(null)
  const [openDocError, setOpenDocError] = useState('')

  const handleOpenSimilar = async (documentId: string) => {
    setOpeningDocId(documentId)
    setOpenDocError('')
    try {
      await onOpenDocument(documentId)
    } catch {
      setOpenDocError('Failed to open that document')
    } finally {
      setOpeningDocId(null)
    }
  }

  const modeCard = (value: StudyMode, icon: React.ReactNode, title: string, description: string) => {
    const active = mode === value
    return (
      <button
        type="button"
        onClick={() => setMode(value)}
        className={`text-left p-6 rounded-2xl border backdrop-blur-xl transition-colors ${
          active
            ? 'border-[#D7FF3D]/60 bg-[#D7FF3D]/10'
            : 'border-white/15 bg-white/[0.04] hover:border-white/30'
        }`}
      >
        <div className={`mb-3 ${active ? LIME : 'text-white/60'}`}>{icon}</div>
        <h3 className="text-lg font-medium text-white mb-1 font-sans">{title}</h3>
        <p className="text-sm text-white/60">{description}</p>
      </button>
    )
  }

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
      <main className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center mb-10">
          <h1 className="font-serif text-4xl sm:text-5xl font-light text-white mb-4">
            How do you want to <span className={`italic ${LIME}`}>study</span>?
          </h1>
          <p className="text-lg text-white/60 font-sans font-light">
            Review with flashcards first, or jump straight into a practice quiz
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <Alert className="mb-6 border-red-400/30 bg-red-500/10">
            <X className="h-4 w-4 text-red-300" />
            <AlertDescription className="text-red-200">{error}</AlertDescription>
          </Alert>
        )}

        {/* Memory layer: overlap with previously uploaded material */}
        {!similarDismissed && similarDocuments.length > 0 && (
          <div className="mb-6 rounded-2xl border border-[#D7FF3D]/30 bg-[#D7FF3D]/[0.06] backdrop-blur-xl p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <History className={`h-5 w-5 mt-0.5 shrink-0 ${LIME}`} />
                <div>
                  <p className="text-white font-medium font-sans mb-1">
                    You&apos;ve studied similar material before
                  </p>
                  <ul className="text-sm text-white/70 space-y-1.5">
                    {similarDocuments.map(doc => (
                      <li key={doc.document_id} className="flex flex-wrap items-center gap-x-2">
                        <span>
                          <span className="text-white">{doc.filename}</span>
                          {' — '}
                          {Math.round(doc.overlap * 100)}% of this upload overlaps
                          {' · uploaded '}
                          {new Date(doc.uploaded_at).toLocaleDateString()}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleOpenSimilar(doc.document_id)}
                          disabled={openingDocId !== null}
                          className={`underline underline-offset-2 hover:text-white transition-colors disabled:opacity-50 ${LIME}`}
                        >
                          {openingDocId === doc.document_id ? 'Opening…' : 'Open that document'}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <p className="text-sm text-white/50 mt-2">
                    Continue for a fresh set — it will emphasize concepts you previously struggled with —
                    or jump back to the earlier material.
                  </p>
                  {openDocError && <p className="text-sm text-red-300 mt-2">{openDocError}</p>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSimilarDismissed(true)}
                aria-label="Dismiss"
                className="text-white/40 hover:text-white transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* Mode Selection */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {modeCard(
            'pretest',
            <Target className="h-8 w-8" />,
            'Test me first',
            'A short pretest before you read — even wrong guesses prime you to retain the material'
          )}
          {modeCard(
            'flashcards',
            <BookOpen className="h-8 w-8" />,
            'Study with flashcards',
            'Review key concepts from your material before testing yourself'
          )}
          {modeCard(
            'quiz',
            <PencilLine className="h-8 w-8" />,
            'Take a practice quiz',
            'Get a summary and practice questions generated from your material'
          )}
          {modeCard(
            'tutor',
            <GraduationCap className="h-8 w-8" />,
            'Learn with the tutor',
            'One question at a time, adapting to your weakest concepts as you answer'
          )}
        </div>

        {/* Configuration Panel */}
        <div className="bg-white/[0.06] backdrop-blur-xl rounded-2xl border border-white/15 p-8">
          {mode === 'flashcards' ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <SubjectSelect
                  subjectId={formData.subjectId}
                  onSelect={(subject: Subject) =>
                    setFormData(prev => ({ ...prev, subjectId: subject.id, subjectName: subject.name }))
                  }
                />

                <div className="space-y-2">
                  <Label className="text-sm font-medium text-white/70">Card Type</Label>
                  <Select
                    value={formData.cardType}
                    onValueChange={(value: StudyFormData['cardType']) =>
                      setFormData(prev => ({ ...prev, cardType: value }))
                    }
                  >
                    <SelectTrigger className="bg-white/5 border-white/20 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#0d1230] border-white/15 text-white">
                      <SelectItem value="definition">Definitions</SelectItem>
                      <SelectItem value="concept">Concepts</SelectItem>
                      <SelectItem value="fact">Facts</SelectItem>
                      <SelectItem value="mixed">Mixed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium text-white/70">Number of Cards</Label>
                  <Select
                    value={formData.numCards.toString()}
                    onValueChange={(value) =>
                      setFormData(prev => ({ ...prev, numCards: parseInt(value) }))
                    }
                  >
                    <SelectTrigger className="bg-white/5 border-white/20 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#0d1230] border-white/15 text-white">
                      {[5, 10, 15, 20, 25, 30].map(num => (
                        <SelectItem key={num} value={num.toString()}>{num} cards</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {!flashcards && (
                <div className="flex justify-end mt-8">
                  <Button
                    onClick={handleGenerateFlashcards}
                    disabled={loading}
                    className={`${LIME_BG} text-black hover:bg-[#c2e836]`}
                  >
                    {loading ? (
                      <>
                        <div className="animate-spin h-4 w-4 mr-2 border-2 border-black/60 border-t-transparent rounded-full" />
                        {progressStage || 'Generating...'}
                      </>
                    ) : (
                      'Generate Flashcards'
                    )}
                  </Button>
                </div>
              )}
            </>
          ) : mode === 'quiz' ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <SubjectSelect
                  labelHtmlFor="subject"
                  subjectId={formData.subjectId}
                  onSelect={(subject: Subject) =>
                    setFormData(prev => ({ ...prev, subjectId: subject.id, subjectName: subject.name }))
                  }
                />

                <div className="space-y-2">
                  <Label htmlFor="summary-type" className="text-sm font-medium text-white/70">Summary Format</Label>
                  <Select
                    value={formData.summaryType}
                    onValueChange={(value: SummaryType) =>
                      setFormData(prev => ({ ...prev, summaryType: value }))
                    }
                  >
                    <SelectTrigger className="bg-white/5 border-white/20 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#0d1230] border-white/15 text-white">
                      <SelectItem value="short">Short (2-3 paragraphs)</SelectItem>
                      <SelectItem value="bullet_points">Bullet Points</SelectItem>
                      <SelectItem value="detailed">Detailed Summary</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="num-questions" className="text-sm font-medium text-white/70">Number of Questions</Label>
                  <Select
                    value={formData.numQuestions.toString()}
                    onValueChange={(value) =>
                      setFormData(prev => ({ ...prev, numQuestions: parseInt(value) }))
                    }
                  >
                    <SelectTrigger className="bg-white/5 border-white/20 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#0d1230] border-white/15 text-white">
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20].map(num => (
                        <SelectItem key={num} value={num.toString()}>{num} questions</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="difficulty" className="text-sm font-medium text-white/70">Difficulty Level</Label>
                  <Select
                    value={formData.difficulty}
                    onValueChange={(value: Difficulty) =>
                      setFormData(prev => ({ ...prev, difficulty: value }))
                    }
                  >
                    <SelectTrigger className="bg-white/5 border-white/20 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#0d1230] border-white/15 text-white">
                      <SelectItem value="easy">Easy (Basic concepts)</SelectItem>
                      <SelectItem value="medium">Medium (Mixed)</SelectItem>
                      <SelectItem value="hard">Hard (Critical thinking)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex justify-end mt-8">
                <Button
                  onClick={handleGenerate}
                  disabled={loading}
                  className={`${LIME_BG} text-black hover:bg-[#c2e836]`}
                >
                  {loading ? (
                    <>
                      <div className="animate-spin h-4 w-4 mr-2 border-2 border-black/60 border-t-transparent rounded-full" />
                      {progressStage || 'Generating...'}
                    </>
                  ) : (
                    'Generate Quiz'
                  )}
                </Button>
              </div>
            </>
          ) : mode === 'pretest' ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <SubjectSelect
                  subjectId={formData.subjectId}
                  onSelect={(subject: Subject) =>
                    setFormData(prev => ({ ...prev, subjectId: subject.id, subjectName: subject.name }))
                  }
                />

                <div className="space-y-2">
                  <Label className="text-sm font-medium text-white/70">Summary Format (shown after)</Label>
                  <Select
                    value={formData.summaryType}
                    onValueChange={(value: SummaryType) =>
                      setFormData(prev => ({ ...prev, summaryType: value }))
                    }
                  >
                    <SelectTrigger className="bg-white/5 border-white/20 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#0d1230] border-white/15 text-white">
                      <SelectItem value="short">Short (2-3 paragraphs)</SelectItem>
                      <SelectItem value="bullet_points">Bullet Points</SelectItem>
                      <SelectItem value="detailed">Detailed Summary</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <p className="text-sm text-white/50 mt-6">
                3-5 quick questions on the key concepts, before you see any summary. Testing yourself
                first — even failing — measurably improves what you retain from reading afterwards, and
                the summary will flag exactly the spots you missed.
              </p>

              <div className="flex justify-end mt-8">
                <Button
                  onClick={handleStartPretest}
                  disabled={loading || !formData.subjectName}
                  className={`${LIME_BG} text-black hover:bg-[#c2e836]`}
                >
                  {loading ? (
                    <>
                      <div className="animate-spin h-4 w-4 mr-2 border-2 border-black/60 border-t-transparent rounded-full" />
                      {progressStage || 'Preparing your pretest...'}
                    </>
                  ) : (
                    'Start Pretest'
                  )}
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <SubjectSelect
                  subjectId={formData.subjectId}
                  onSelect={(subject: Subject) =>
                    setFormData(prev => ({ ...prev, subjectId: subject.id, subjectName: subject.name }))
                  }
                />

                <div className="space-y-2">
                  <Label className="text-sm font-medium text-white/70">Mode</Label>
                  <Select
                    value={formData.tutorMode}
                    onValueChange={(value) =>
                      setFormData(prev => ({ ...prev, tutorMode: value as TutorMode }))
                    }
                  >
                    <SelectTrigger className="bg-white/5 border-white/20 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#0d1230] border-white/15 text-white">
                      <SelectItem value="vibe_check">Vibe check — a quick pass over the core ideas</SelectItem>
                      <SelectItem value="locked_in">Locked in — drilled until it actually sticks</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <p className="text-sm text-white/50 mt-6">
                No question count, no difficulty to pick — the tutor keeps probing each concept in
                new framings until it&apos;s convinced you&apos;ve actually learned it, then stops on its own.
              </p>

              <div className="flex justify-end mt-8">
                <Button
                  onClick={handleStartTutor}
                  disabled={loading || !formData.subjectName}
                  className={`${LIME_BG} text-black hover:bg-[#c2e836]`}
                >
                  {loading ? (
                    <>
                      <div className="animate-spin h-4 w-4 mr-2 border-2 border-black/60 border-t-transparent rounded-full" />
                      {progressStage || 'Preparing your session...'}
                    </>
                  ) : (
                    'Start Tutor Session'
                  )}
                </Button>
              </div>
            </>
          )}
        </div>

        {/* Generated Flashcards */}
        {mode === 'flashcards' && flashcards && (
          <div className="mt-8">
            <div className="bg-white/[0.06] backdrop-blur-xl rounded-2xl border border-white/15 p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-xl font-bold text-white mb-2 font-sans">Your Flashcard Set</h3>
                  <p className="text-sm text-white/60">
                    {flashcards.total_cards} {flashcards.card_type} flashcards • Click to flip
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={handleGenerateFlashcards}
                  disabled={loading}
                  size="sm"
                  className="border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white"
                >
                  {loading ? 'Regenerating...' : 'Regenerate'}
                </Button>
              </div>

              <FlashcardCarousel cards={flashcards.flashcards} />

              <div className="flex justify-end mt-6">
                <Button
                  onClick={() => setMode('quiz')}
                  className={`${LIME_BG} text-black hover:bg-[#c2e836]`}
                >
                  Ready? Take the quiz
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
