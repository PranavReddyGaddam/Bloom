'use client'

import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
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
  TutorSource,
  TutorStartResponse,
  PretestStartResponse,
  DueConceptReview,
  StudyOutput,
  PRESETS
} from '@/types'
import { UploadStep } from '@/components/study/UploadStep'
import { LessonView } from '@/components/study/LessonView'
import { GenerationProgress, OutputProgress } from '@/components/study/GenerationProgress'
import { Attachment } from '@/components/study/StudyBar'
import { TutorView } from '@/components/study/TutorView'
import { PretestView } from '@/components/study/PretestView'

interface BloomAppProps {
  initialStep?: 'upload' | 'lesson'
}

const STORED_FILE_KEY = 'bloom-attachments'
// Active tutor session pointer, so a page refresh can resume the session
// that is still alive server-side (sessionStorage: gone when the tab closes).
const TUTOR_SESSION_KEY = 'bloom-tutor-session'

export default function BloomApp({ initialStep = 'upload' }: BloomAppProps) {
  const router = useRouter()

  // The study material, and the single source of truth for it. Uploads and
  // library picks both land here, so "what am I studying" has one answer
  // instead of four fields that can disagree.
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [similarDocuments, setSimilarDocuments] = useState<SimilarDocument[]>([])

  // Everything downstream consumes plain text plus a document id, so derive
  // both from the attachments rather than storing them separately.
  //
  // The multi-document form prefixes each file with its name; a single
  // attachment stays bare, which is the shape the one-file paths already
  // expect. `documentId` is only meaningful when one document is attached —
  // with several, the material spans them all and no single id applies.
  //
  // Memoized because these feed useCallback dependency arrays — a fresh array
  // or string each render would defeat every callback that depends on them.
  const textContent = useMemo(() => (
    attachments.length === 1
      ? attachments[0].textContent
      : attachments.map(a => `[${a.filename}]\n${a.textContent}`).join('\n\n')
  ), [attachments])
  const documentId = attachments.length === 1 ? attachments[0].documentId : null
  // The tutor interleaves concepts across files (ROADMAP_LEARNING 3); it only
  // needs the split-out sources when there is more than one.
  const sources: TutorSource[] = useMemo(() => (
    attachments.length > 1
      ? attachments.map(a => ({
          text_content: a.textContent,
          filename: a.filename,
          document_id: a.documentId,
        }))
      : []
  ), [attachments])
  // Stage-level progress text for the long operations ("Describing diagrams
  // and figures (4 of 12 pages)"), polled from the backend while loading.
  const [progressStage, setProgressStage] = useState<string>('')

  // handleGenerate needs to hand off to the tutor for a tutor-only selection,
  // but handleStartTutor is declared after it. A ref breaks that cycle without
  // reordering the file or making either callback depend on the other.
  const handleStartTutorRef = useRef<(() => Promise<void>) | null>(null)

  // Per-artifact progress for a fan-out generation. Each selected output gets
  // its own progress id and its own poll loop, so the rows advance
  // independently instead of racing over one shared stage string.
  const [outputProgress, setOutputProgress] = useState<Partial<Record<StudyOutput, OutputProgress>>>({})

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

  // Same, but writes into one artifact's row rather than the shared string.
  const pollOutputProgress = useCallback((output: StudyOutput, progressId: string) => {
    const timer = setInterval(async () => {
      try {
        const { stage } = await api.getProgress(progressId)
        if (stage) {
          setOutputProgress(prev => ({
            ...prev,
            [output]: { ...(prev[output] ?? { status: 'running' }), stage, status: 'running' },
          }))
        }
      } catch {
        // ignore — the row keeps its last stage
      }
    }, 800)
    return () => clearInterval(timer)
  }, [])

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>('')
  const [summary, setSummary] = useState<SummaryResponse | null>(null)
  const [quiz, setQuiz] = useState<QuizResponse | null>(null)
  const [flashcards, setFlashcards] = useState<FlashcardResponse | null>(null)
  const [quizResult, setQuizResult] = useState<QuizResult | null>(null)
  const [userAnswers, setUserAnswers] = useState<UserAnswer[]>([])
  const [currentStep, setCurrentStep] = useState<'upload' | 'tutor' | 'pretest' | 'lesson'>(initialStep)
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
    tutorMode: 'vibe_check',
    outputs: [...PRESETS.quick_review.outputs],
    preset: 'quick_review',
    focusNote: ''
  })

  // Restore the attached material across page refreshes.
  //
  // Only document ids are stored, not their text: the text is server-owned and
  // can be large, and a row can disappear while this entry survives (the
  // library's delete button). Re-fetching each id both refreshes the content
  // and proves it still exists — a 404 simply drops that attachment rather
  // than leaving a stale pointer that fails every document-scoped action.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const stored = localStorage.getItem(STORED_FILE_KEY)
        if (!stored) return
        const ids: string[] = JSON.parse(stored)
        if (!Array.isArray(ids) || ids.length === 0) return

        const restored = await Promise.all(ids.map(async (id) => {
          try {
            const content = await api.getDocumentContent(id)
            return {
              documentId: content.id,
              filename: content.filename,
              textContent: content.text_content,
            }
          } catch {
            // Gone, or unreachable — either way it can't be studied now.
            return null
          }
        }))

        if (cancelled) return
        const alive = restored.filter((a): a is Attachment => a !== null)
        setAttachments(alive)
        if (alive.length === 0) localStorage.removeItem(STORED_FILE_KEY)
      } catch {
        localStorage.removeItem(STORED_FILE_KEY)
      }
    })()
    return () => { cancelled = true }
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

  // Persist which documents are attached. Ids only — see the restore effect.
  const rememberAttachments = useCallback((next: Attachment[]) => {
    if (next.length === 0) localStorage.removeItem(STORED_FILE_KEY)
    else localStorage.setItem(STORED_FILE_KEY, JSON.stringify(next.map(a => a.documentId)))
  }, [])

  // Upload a file and attach it. Extraction is the slow part, so this reports
  // stage progress; it deliberately does not navigate — the student stays on
  // the bar and keeps composing while material accumulates.
  const handleAttachFile = useCallback(async (selectedFile: File) => {
    const name = selectedFile.name.toLowerCase()
    if (!/\.(pdf|docx|pptx)$/.test(name)) {
      throw new Error('Supported file types are .pdf, .docx and .pptx')
    }

    setError('')
    setLoading(true)

    const progressId = crypto.randomUUID()
    const stopPolling = pollProgress(progressId)
    try {
      const result = await api.uploadPDF(selectedFile, progressId)
      if (!result.document_id) {
        throw new Error('That file was processed but could not be saved')
      }
      const attachment: Attachment = {
        documentId: result.document_id,
        filename: result.filename || selectedFile.name,
        textContent: result.text_content,
      }
      setAttachments(prev => {
        const next = [...prev.filter(a => a.documentId !== attachment.documentId), attachment]
        rememberAttachments(next)
        return next
      })
      // Overlap warnings only make sense against a fresh upload.
      setSimilarDocuments(result.similar_documents ?? [])
    } finally {
      stopPolling()
      setLoading(false)
    }
  }, [pollProgress, rememberAttachments])

  // Attach an existing library document — the same action as uploading, minus
  // the upload, so it lands in exactly the same place.
  const handleAttachDocument = useCallback(async (docId: string) => {
    setError('')
    const content = await api.getDocumentContent(docId)
    setAttachments(prev => {
      if (prev.some(a => a.documentId === content.id)) return prev
      const next = [...prev, {
        documentId: content.id,
        filename: content.filename,
        textContent: content.text_content,
      }]
      rememberAttachments(next)
      return next
    })
  }, [rememberAttachments])

  const handleRemoveAttachment = useCallback((docId: string) => {
    setAttachments(prev => {
      const next = prev.filter(a => a.documentId !== docId)
      rememberAttachments(next)
      return next
    })
    // The overlap notice belongs to a specific upload; once the material
    // changes it no longer describes what's attached.
    setSimilarDocuments([])
  }, [rememberAttachments])

  // Fan out over the selected artifact outputs, each on its own progress id
  // and poll loop. Uses allSettled deliberately: one artifact failing must not
  // lose the others, so failures land on their own row and the lesson screen
  // simply omits that tab.
  const handleGenerate = useCallback(async (focusConcepts?: string[]) => {
    if (!textContent) {
      return
    }

    const wanted = formData.outputs.filter(
      (o): o is 'summary' | 'flashcards' | 'quiz' =>
        o === 'summary' || o === 'flashcards' || o === 'quiz'
    )

    setPretestFocus(focusConcepts ?? [])

    // Tutor-only (or tutor + pretest) selections have nothing to generate —
    // go straight into the session rather than showing an empty lesson.
    if (wanted.length === 0) {
      if (formData.outputs.includes('tutor')) {
        await handleStartTutorRef.current?.()
      }
      return
    }

    setLoading(true)
    setError('')
    setSummary(null)
    setFlashcards(null)
    setQuiz(null)
    setOutputProgress(
      Object.fromEntries(wanted.map(o => [o, { stage: null, status: 'running' as const }]))
    )
    setCurrentStep('lesson')

    const hasOverlap = similarDocuments.length > 0
    const focusNote = formData.focusNote

    // Each output runs behind its own id + poll loop, and reports into its own
    // row. The generic `run` wrapper is what keeps that bookkeeping in one
    // place instead of repeated three times.
    const run = async <T,>(
      output: StudyOutput,
      call: (progressId: string) => Promise<T>,
      apply: (result: T) => void,
    ) => {
      const progressId = crypto.randomUUID()
      const stop = pollOutputProgress(output, progressId)
      try {
        const result = await call(progressId)
        apply(result)
        setOutputProgress(prev => ({ ...prev, [output]: { stage: null, status: 'done' } }))
      } catch (err) {
        setOutputProgress(prev => ({
          ...prev,
          [output]: {
            stage: null,
            status: 'failed',
            error: err instanceof APIError ? err.message : undefined,
          },
        }))
      } finally {
        stop()
      }
    }

    const jobs = wanted.map(output => {
      if (output === 'summary') {
        return run(
          'summary',
          (id) => api.generateSummary(
            textContent, formData.summaryType, formData.subjectName, id, hasOverlap,
            focusConcepts, focusNote,
          ),
          setSummary,
        )
      }
      if (output === 'flashcards') {
        return run(
          'flashcards',
          (id) => api.generateFlashcards(
            textContent, formData.numCards, formData.subjectName, formData.cardType,
            documentId, id, focusNote,
          ),
          setFlashcards,
        )
      }
      return run(
        'quiz',
        (id) => api.generateQuiz(
          textContent, formData.numQuestions, formData.subjectName, formData.difficulty,
          id, hasOverlap, focusNote,
        ),
        setQuiz,
      )
    })

    await Promise.allSettled(jobs)

    setUserAnswers([])
    setQuizResult(null)
    setLoading(false)
    router.push('/upload?step=lesson')
  }, [textContent, formData, router, pollOutputProgress, similarDocuments, documentId])

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
        documentId,
        sources.length > 0 ? sources : undefined
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
  }, [textContent, formData, pollProgress, documentId, sources])

  handleStartTutorRef.current = handleStartTutor

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
  }, [textContent, formData, pollProgress, documentId])

  // The study bar's CTA. Pretest is a gate rather than an artifact:
  // when it's selected it runs first, and the rest of the selection generates
  // afterwards from the pretest's continue handler, carrying the missed
  // concepts through as emphasis.
  const handleStart = useCallback(() => {
    if (formData.outputs.includes('pretest')) {
      void handleStartPretest()
      return
    }
    void handleGenerate()
  }, [formData.outputs, handleStartPretest, handleGenerate])

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
      documentId,
      sources.length > 0 ? sources : undefined
    )
    setTutorSession(session)
    sessionStorage.setItem(TUTOR_SESSION_KEY, JSON.stringify({
      id: session.session_id,
      subjectName: formData.subjectName,
    }))
  }, [textContent, formData, documentId, sources])

  // Concept spaced repetition: one click on a due concept re-opens its
  // source document from the library and starts a short tutor session
  // restricted to that concept. The refresher's results update the
  // concept's mastery and reschedule its next review server-side.
  const handleStartRefresher = useCallback(async (review: DueConceptReview) => {
    const content = await api.getDocumentContent(review.document_id)
    const subjectName = review.subject || review.concept
    // The refresher replaces whatever was attached: it's a session about one
    // specific document, not an addition to a set the student was building.
    const attachment: Attachment = {
      documentId: content.id,
      filename: content.filename,
      textContent: content.text_content,
    }
    setAttachments([attachment])
    rememberAttachments([attachment])
    setSimilarDocuments([])
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
  }, [rememberAttachments])

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

  const resetApp = useCallback(() => {
    setAttachments([])
    setOutputProgress({})
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
        formData={formData}
        setFormData={setFormData}
        attachments={attachments}
        onAttachFile={handleAttachFile}
        onAttachDocument={handleAttachDocument}
        onRemoveAttachment={handleRemoveAttachment}
        onStart={handleStart}
        loading={loading}
        error={error}
        progressStage={progressStage}
        resetApp={resetApp}
        onStartRefresher={handleStartRefresher}
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
          onBack={() => setCurrentStep('upload')}
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
            // Back to the lesson if there is one to go back to — the tutor is
            // usually reached from it — otherwise to the bar.
            setCurrentStep(summary || quiz || flashcards ? 'lesson' : 'upload')
          }}
          resetApp={resetApp}
          onPracticeConcepts={handlePracticeConcepts}
          onSessionComplete={() => sessionStorage.removeItem(TUTOR_SESSION_KEY)}
        />
      </main>
    )
  } else if (loading) {
    // Fan-out in flight: a row per selected artifact, each advancing on its
    // own progress id. Artifacts that finish early are already in state and
    // appear the moment the whole batch settles.
    return (
      <main className="relative z-10 max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center mb-10">
          <h1 className="font-serif text-4xl sm:text-5xl font-light text-white mb-4">
            Building your <span className="italic text-[#D7FF3D]">lesson</span>
          </h1>
          <p className="text-lg text-white/60 font-sans font-light">
            {formData.focusNote
              ? 'Focusing on what you asked for'
              : 'This takes a moment — each piece is generated from your material'}
          </p>
        </div>
        <GenerationProgress
          outputs={formData.outputs.filter(o => o !== 'pretest' && o !== 'tutor')}
          progress={outputProgress}
        />
      </main>
    )
  } else {
    return (
      <LessonView
        summary={summary}
        flaggedConcepts={pretestFocus}
        flashcards={flashcards}
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
        outputs={formData.outputs}
        onStartTutor={handleStartTutor}
        setCurrentStep={setCurrentStep}
        resetApp={resetApp}
      />
    )
  }
}
