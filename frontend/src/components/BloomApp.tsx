'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { api, APIError } from '@/lib/api'
import {
  SummaryResponse,
  QuizResponse,
  QuizResult,
  UserAnswer,
  FlashcardResponse,
  StudyFormData,
  Difficulty,
  SimilarDocument,
  TutorStartResponse,
  PretestStartResponse,
  DueConceptReview
} from '@/types'
import { UploadStep } from '@/components/study/UploadStep'
import { ConfigureStep } from '@/components/study/ConfigureStep'
import { ResultsStep } from '@/components/study/ResultsStep'
import { TutorView } from '@/components/study/TutorView'
import { PretestView } from '@/components/study/PretestView'

interface BloomAppProps {
  initialStep?: 'upload' | 'configure' | 'results'
}

export interface UploadedFileInfo {
  name: string
  size: number
}

const STORED_FILE_KEY = 'bloom-uploaded-file'
// Active tutor session pointer, so a page refresh can resume the session
// that is still alive server-side (sessionStorage: gone when the tab closes).
const TUTOR_SESSION_KEY = 'bloom-tutor-session'

export default function BloomApp({ initialStep = 'upload' }: BloomAppProps) {
  const router = useRouter()

  // File input ref
  const fileInputRef = useRef<HTMLInputElement>(null)

  // State management
  const [file, setFile] = useState<UploadedFileInfo | null>(null)
  const [textContent, setTextContent] = useState<string>('')
  // Library id of the current material (memory layer), for linking
  // generated flashcards back to their source document.
  const [documentId, setDocumentId] = useState<string | null>(null)
  const [similarDocuments, setSimilarDocuments] = useState<SimilarDocument[]>([])
  // Stage-level progress text for the long operations ("Describing diagrams
  // and figures (4 of 12 pages)"), polled from the backend while loading.
  const [progressStage, setProgressStage] = useState<string>('')

  // Restore the uploaded file across page refreshes
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORED_FILE_KEY)
      if (stored) {
        const { name, size, textContent: storedText, documentId: storedDocId } = JSON.parse(stored)
        setFile({ name, size })
        setTextContent(storedText)
        setDocumentId(storedDocId ?? null)
      }
    } catch {
      localStorage.removeItem(STORED_FILE_KEY)
    }
  }, [])

  // Poll the backend's stage-level progress for one operation. Returns a
  // stop function; progress is cosmetic, so poll errors are swallowed.
  const pollProgress = useCallback((progressId: string) => {
    const timer = setInterval(async () => {
      try {
        const { stage } = await api.getProgress(progressId)
        if (stage) setProgressStage(stage)
      } catch {
        // ignore — the generic loading text stays up
      }
    }, 800)
    return () => {
      clearInterval(timer)
      setProgressStage('')
    }
  }, [])

  // Resume an in-flight tutor session after a refresh: the session lives
  // server-side; we only stored its id. A dead/finished session just clears
  // the pointer and leaves the normal flow untouched.
  useEffect(() => {
    const stored = sessionStorage.getItem(TUTOR_SESSION_KEY)
    if (!stored) return
    let cancelled = false
    ;(async () => {
      try {
        const { id, subjectName } = JSON.parse(stored)
        const session = await api.getTutorSession(id)
        if (cancelled) return
        if (subjectName) {
          setFormData(prev => ({ ...prev, subjectName }))
        }
        setTutorSession(session)
        setCurrentStep('tutor')
      } catch {
        sessionStorage.removeItem(TUTOR_SESSION_KEY)
      }
    })()
    return () => { cancelled = true }
  }, [])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>('')
  const [summary, setSummary] = useState<SummaryResponse | null>(null)
  const [quiz, setQuiz] = useState<QuizResponse | null>(null)
  const [flashcards, setFlashcards] = useState<FlashcardResponse | null>(null)
  const [quizResult, setQuizResult] = useState<QuizResult | null>(null)
  const [userAnswers, setUserAnswers] = useState<UserAnswer[]>([])
  const [currentStep, setCurrentStep] = useState<'upload' | 'configure' | 'results' | 'tutor' | 'pretest'>(initialStep)
  const [tutorSession, setTutorSession] = useState<TutorStartResponse | null>(null)
  // Pretesting: the active pretest and, after grading, the missed concepts
  // to emphasize during generation and flag in the summary view.
  const [pretest, setPretest] = useState<PretestStartResponse | null>(null)
  const [pretestFocus, setPretestFocus] = useState<string[]>([])
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)

  // Form data
  const [formData, setFormData] = useState<StudyFormData>({
    numQuestions: 5,
    numCards: 10,
    subjectId: null,
    subjectName: '',
    difficulty: 'medium',
    summaryType: 'bullet_points',
    cardType: 'mixed',
    tutorMode: 'vibe_check'
  })

  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0]

    if (!selectedFile) return

    if (selectedFile.type !== 'application/pdf') {
      setError('Please select a PDF file')
      return
    }

    setFile({ name: selectedFile.name, size: selectedFile.size })
    setError('')
    setLoading(true)

    const progressId = crypto.randomUUID()
    const stopPolling = pollProgress(progressId)
    try {
      const result = await api.uploadPDF(selectedFile, progressId)
      setTextContent(result.text_content)
      setDocumentId(result.document_id ?? null)
      setSimilarDocuments(result.similar_documents ?? [])
      localStorage.setItem(STORED_FILE_KEY, JSON.stringify({
        name: selectedFile.name,
        size: selectedFile.size,
        textContent: result.text_content,
        documentId: result.document_id ?? null
      }))
      setCurrentStep('configure')
      router.push('/upload?step=configure')
    } catch (err) {
      setError(err instanceof APIError ? err.message : 'Failed to upload PDF')
    } finally {
      stopPolling()
      setLoading(false)
    }
  }, [router, pollProgress])

  const handleGenerate = useCallback(async (focusConcepts?: string[]) => {
    if (!textContent) {
      return
    }

    setLoading(true)
    setError('')
    setPretestFocus(focusConcepts ?? [])

    // Both generations report progress under one id — the latest stage from
    // either pipeline is what the user sees.
    const progressId = crypto.randomUUID()
    const stopPolling = pollProgress(progressId)
    const hasOverlap = similarDocuments.length > 0
    try {
      // Generate summary and quiz in parallel
      const [summaryResult, quizResult] = await Promise.all([
        api.generateSummary(textContent, formData.summaryType, formData.subjectName, progressId, hasOverlap, focusConcepts),
        api.generateQuiz(
          textContent,
          formData.numQuestions,
          formData.subjectName,
          formData.difficulty,
          progressId,
          hasOverlap
        )
      ])

      setSummary(summaryResult)
      setQuiz(quizResult)
      setCurrentStep('results')
      setUserAnswers([])
      setQuizResult(null)

      // Update URL to reflect quiz state
      router.push('/upload?step=results')
    } catch (err) {
      setError(err instanceof APIError ? err.message : 'Failed to generate content')
    } finally {
      stopPolling()
      setLoading(false)
    }
  }, [textContent, formData, router, pollProgress, similarDocuments])

  const handleGenerateFlashcards = useCallback(async () => {
    if (!textContent) {
      return
    }

    setLoading(true)
    setError('')

    try {
      const result = await api.generateFlashcards(
        textContent,
        formData.numCards,
        formData.subjectName,
        formData.cardType,
        documentId
      )
      setFlashcards(result)
    } catch (err) {
      setError(err instanceof APIError ? err.message : 'Failed to generate flashcards')
    } finally {
      setLoading(false)
    }
  }, [textContent, formData, documentId])

  const handleStartTutor = useCallback(async () => {
    if (!textContent || !formData.subjectName) {
      return
    }

    setLoading(true)
    setError('')

    const progressId = crypto.randomUUID()
    const stopPolling = pollProgress(progressId)
    try {
      const session = await api.startTutorSession(
        textContent,
        formData.subjectName,
        formData.tutorMode,
        undefined,
        progressId,
        documentId
      )
      setTutorSession(session)
      sessionStorage.setItem(TUTOR_SESSION_KEY, JSON.stringify({
        id: session.session_id,
        subjectName: formData.subjectName,
      }))
      setCurrentStep('tutor')
    } catch (err) {
      setError(err instanceof APIError ? err.message : 'Failed to start tutor session')
    } finally {
      stopPolling()
      setLoading(false)
    }
  }, [textContent, formData, pollProgress, documentId])

  // Pretesting: a short quiz before any summary is shown. Grading writes
  // into the persistent concept mastery server-side, so tutor sessions
  // started afterwards begin calibrated instead of at the 0.5 midpoint.
  const handleStartPretest = useCallback(async () => {
    if (!textContent || !formData.subjectName) return

    setLoading(true)
    setError('')

    const progressId = crypto.randomUUID()
    const stopPolling = pollProgress(progressId)
    try {
      const result = await api.startPretest(textContent, formData.subjectName, progressId, documentId)
      setPretest(result)
      setPretestFocus([])
      setCurrentStep('pretest')
    } catch (err) {
      setError(err instanceof APIError ? err.message : 'Failed to start pretest')
    } finally {
      stopPolling()
      setLoading(false)
    }
  }, [textContent, formData, pollProgress])

  const handleSubmitPretest = useCallback(async (answers: string[]) => {
    if (!pretest) throw new APIError('No active pretest')
    return api.submitPretest(pretest.pretest_id, answers)
  }, [pretest])

  const handlePracticeConcepts = useCallback(async (concepts: string[]) => {
    if (!textContent || !formData.subjectName) return
    const session = await api.startTutorSession(
      textContent,
      formData.subjectName,
      formData.tutorMode,
      concepts,
      undefined,
      documentId
    )
    setTutorSession(session)
    sessionStorage.setItem(TUTOR_SESSION_KEY, JSON.stringify({
      id: session.session_id,
      subjectName: formData.subjectName,
    }))
  }, [textContent, formData, documentId])

  // Concept spaced repetition: one click on a due concept re-opens its
  // source document from the library and starts a short tutor session
  // restricted to that concept. The refresher's results update the
  // concept's mastery and reschedule its next review server-side.
  const handleStartRefresher = useCallback(async (review: DueConceptReview) => {
    const content = await api.getDocumentContent(review.document_id)
    const subjectName = review.subject || review.concept
    setFile({ name: content.filename, size: 0 })
    setTextContent(content.text_content)
    setDocumentId(content.id)
    setSimilarDocuments([])
    localStorage.setItem(STORED_FILE_KEY, JSON.stringify({
      name: content.filename,
      size: 0,
      textContent: content.text_content,
      documentId: content.id
    }))
    setFormData(prev => ({ ...prev, subjectName }))
    const session = await api.startTutorSession(
      content.text_content,
      subjectName,
      'vibe_check',
      [review.concept],
      undefined,
      content.id
    )
    setTutorSession(session)
    sessionStorage.setItem(TUTOR_SESSION_KEY, JSON.stringify({
      id: session.session_id,
      subjectName,
    }))
    setCurrentStep('tutor')
  }, [])

  // Documents library: make a stored upload the active study material —
  // "study this again" without re-uploading the file.
  const handleOpenDocument = useCallback(async (docId: string) => {
    setError('')
    const content = await api.getDocumentContent(docId)
    setFile({ name: content.filename, size: 0 })
    setTextContent(content.text_content)
    setDocumentId(content.id)
    setSimilarDocuments([])
    localStorage.setItem(STORED_FILE_KEY, JSON.stringify({
      name: content.filename,
      size: 0,
      textContent: content.text_content,
      documentId: content.id
    }))
    setSummary(null)
    setQuiz(null)
    setFlashcards(null)
    setQuizResult(null)
    setUserAnswers([])
    setCurrentStep('configure')
    router.push('/upload?step=configure')
  }, [router])

  const handleAnswerSelect = useCallback((questionIndex: number, selectedOption: string) => {
    setUserAnswers(prev => {
      const updated = prev.filter(a => a.questionIndex !== questionIndex)
      return [...updated, { questionIndex, selectedOption }]
    })
  }, [])

  const handleSubmitQuiz = useCallback(async () => {
    if (!quiz || !formData.subjectId || userAnswers.length !== quiz.questions.length) return

    setLoading(true)

    try {
      const answers = quiz.questions.map((_, index) => {
        const userAnswer = userAnswers.find(a => a.questionIndex === index)
        return userAnswer?.selectedOption || ''
      })

      const result = await api.checkAnswers(quiz.questions, answers, formData.subjectId, quiz.difficulty as Difficulty)
      setQuizResult(result)
    } catch (err) {
      setError(err instanceof APIError ? err.message : 'Failed to check answers')
    } finally {
      setLoading(false)
    }
  }, [quiz, userAnswers, formData.subjectId])

  const removeFile = useCallback(() => {
    setFile(null)
    setTextContent('')
    setDocumentId(null)
    setSimilarDocuments([])
    localStorage.removeItem(STORED_FILE_KEY)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [])

  const resetApp = useCallback(() => {
    setFile(null)
    setTextContent('')
    setDocumentId(null)
    setSimilarDocuments([])
    localStorage.removeItem(STORED_FILE_KEY)
    setSummary(null)
    setQuiz(null)
    setFlashcards(null)
    setQuizResult(null)
    setUserAnswers([])
    setTutorSession(null)
    setPretest(null)
    setPretestFocus([])
    sessionStorage.removeItem(TUTOR_SESSION_KEY)
    setCurrentStep('upload')
    setError('')

    // Reset URL to upload page
    router.push('/upload')
  }, [router])

  if (currentStep === 'upload') {
    return (
      <UploadStep
        fileInputRef={fileInputRef}
        file={file}
        loading={loading}
        error={error}
        progressStage={progressStage}
        handleFileUpload={handleFileUpload}
        removeFile={removeFile}
        resetApp={resetApp}
        onOpenDocument={handleOpenDocument}
        onStartRefresher={handleStartRefresher}
      />
    )
  } else if (currentStep === 'configure') {
    return (
      <ConfigureStep
        formData={formData}
        setFormData={setFormData}
        loading={loading}
        error={error}
        progressStage={progressStage}
        similarDocuments={similarDocuments}
        flashcards={flashcards}
        handleGenerate={() => handleGenerate()}
        handleGenerateFlashcards={handleGenerateFlashcards}
        handleStartTutor={handleStartTutor}
        handleStartPretest={handleStartPretest}
        onOpenDocument={handleOpenDocument}
        setCurrentStep={setCurrentStep}
        resetApp={resetApp}
      />
    )
  } else if (currentStep === 'pretest' && pretest) {
    return (
      <main className="relative z-10 max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center mb-10">
          <h1 className="font-serif text-4xl sm:text-5xl font-light text-white mb-4">
            Test <span className="italic text-[#D7FF3D]">first</span>, then read
          </h1>
          <p className="text-lg text-white/60 font-sans font-light">
            Answer before studying — even wrong guesses make what you read next stick better
          </p>
        </div>
        <PretestView
          key={pretest.pretest_id}
          pretest={pretest}
          onSubmit={handleSubmitPretest}
          onContinue={(missedConcepts) => handleGenerate(missedConcepts)}
          onStartTutor={handleStartTutor}
          onBack={() => setCurrentStep('configure')}
          loading={loading}
          progressStage={progressStage}
        />
      </main>
    )
  } else if (currentStep === 'tutor' && tutorSession) {
    return (
      <main className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center mb-10">
          <h1 className="font-serif text-4xl sm:text-5xl font-light text-white mb-4">
            Tutor <span className="italic text-[#D7FF3D]">session</span>
          </h1>
          <p className="text-lg text-white/60 font-sans font-light">
            {formData.subjectName} — one question at a time, adapting to you
          </p>
        </div>
        <TutorView
          key={tutorSession.session_id}
          session={tutorSession}
          onExit={() => {
            sessionStorage.removeItem(TUTOR_SESSION_KEY)
            setTutorSession(null)
            setCurrentStep('configure')
          }}
          resetApp={resetApp}
          onPracticeConcepts={handlePracticeConcepts}
          onSessionComplete={() => sessionStorage.removeItem(TUTOR_SESSION_KEY)}
        />
      </main>
    )
  } else {
    return (
      <ResultsStep
        summary={summary}
        flaggedConcepts={pretestFocus}
        quiz={quiz}
        quizResult={quizResult}
        userAnswers={userAnswers}
        currentQuestionIndex={currentQuestionIndex}
        setCurrentQuestionIndex={setCurrentQuestionIndex}
        setQuizResult={setQuizResult}
        setUserAnswers={setUserAnswers}
        handleAnswerSelect={handleAnswerSelect}
        handleSubmitQuiz={handleSubmitQuiz}
        loading={loading}
        setCurrentStep={setCurrentStep}
        resetApp={resetApp}
      />
    )
  }
}
