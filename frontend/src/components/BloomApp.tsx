'use client'

import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { api, APIError } from '@/lib/api'
import { ingestStore, usePendingRunningCount } from '@/lib/ingestStore'
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
  RoleplayStartResponse,
  PretestStartResponse,
  StudyOutput,
  PodcastResponse,
  PRESETS
} from '@/types'
import { UploadStep } from '@/components/study/UploadStep'
import { LessonView } from '@/components/study/LessonView'
import { GenerationProgress, OutputProgress } from '@/components/study/GenerationProgress'
import { Attachment } from '@/components/study/StudyBar'
import { TutorView } from '@/components/study/TutorView'
import { RoleplayView } from '@/components/study/roleplay/RoleplayView'
import { PretestView } from '@/components/study/PretestView'

interface BloomAppProps {
  initialStep?: 'upload' | 'lesson'
}

const STORED_FILE_KEY = 'bloom-attachments'
// Active tutor session pointer, so a page refresh can resume the session
// that is still alive server-side (sessionStorage: gone when the tab closes).
// Exported because the review page starts refresher sessions and hands off
// here to run them.
export const TUTOR_SESSION_KEY = 'bloom-tutor-session'

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
  // A submit clicked while sources were still ingesting. Kept separate from
  // `loading` on purpose: reusing that flag would trip the full-screen
  // "Building your lesson" branch during what is only an attachment.
  const [queuedSubmit, setQueuedSubmit] = useState(false)
  const pendingRunning = usePendingRunningCount()
  const [error, setError] = useState<string>('')
  const [summary, setSummary] = useState<SummaryResponse | null>(null)
  const [quiz, setQuiz] = useState<QuizResponse | null>(null)
  const [flashcards, setFlashcards] = useState<FlashcardResponse | null>(null)
  const [podcast, setPodcast] = useState<PodcastResponse | null>(null)
  const [quizResult, setQuizResult] = useState<QuizResult | null>(null)
  const [userAnswers, setUserAnswers] = useState<UserAnswer[]>([])
  const [currentStep, setCurrentStep] = useState<'upload' | 'tutor' | 'pretest' | 'lesson' | 'roleplay'>(initialStep)
  const [tutorSession, setTutorSession] = useState<TutorStartResponse | null>(null)
  // Voice roleplay (ROADMAP_HONEN 4): the active scene. Created over HTTP;
  // the conversation itself runs on the websocket RoleplayView opens.
  const [roleplaySession, setRoleplaySession] = useState<RoleplayStartResponse | null>(null)
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
    podcastLength: 'medium',
    outputs: [...PRESETS.quick_review.outputs],
    preset: 'quick_review',
    focusNote: ''
  })

  // Documents the student has explicitly removed. Without this, the merge in
  // rememberAttachments would treat a just-removed id as "arrived from the
  // store" and put it straight back.
  const removedIdsRef = useRef<Set<string>>(new Set())

  // Persist which documents are attached. Ids only — see the restore effect.
  // Declared before the effects that call it, not just before its other
  // callers: a `const` referenced above its definition is a runtime error.
  //
  // Removals are honored, but ids this component has never seen are kept: the
  // ingest store appends directly to this key when a job resolves while
  // BloomApp is unmounted, and a plain overwrite from stale `attachments`
  // would silently erase that attachment.
  const rememberAttachments = useCallback((next: Attachment[]) => {
    const ids = next.map(a => a.documentId)
    let merged = ids
    try {
      const stored = localStorage.getItem(STORED_FILE_KEY)
      const prev: unknown = stored ? JSON.parse(stored) : []
      if (Array.isArray(prev)) {
        // Anything already in state was reconciled by this render; anything
        // else arrived from the store and has no in-memory counterpart yet.
        const known = new Set(ids)
        const extra = (prev as string[]).filter(id => typeof id === 'string' && !known.has(id))
        merged = [...ids, ...extra.filter(id => !removedIdsRef.current.has(id))]
      }
    } catch {
      // Unparseable — the current attachments are the better truth.
    }
    if (merged.length === 0) localStorage.removeItem(STORED_FILE_KEY)
    else localStorage.setItem(STORED_FILE_KEY, JSON.stringify(merged))
  }, [])

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
        const { id, subjectName, documentId: sessionDocId } = JSON.parse(stored)
        const session = await api.getTutorSession(id)
        if (cancelled) return
        if (subjectName) {
          setFormData(prev => ({ ...prev, subjectName }))
        }
        // A session started from the review page carries its source document,
        // so the material is loaded and ready when the student exits back out
        // — otherwise they'd land on an empty study bar.
        if (sessionDocId) {
          try {
            const content = await api.getDocumentContent(sessionDocId)
            if (cancelled) return
            const attachment: Attachment = {
              documentId: content.id,
              filename: content.filename,
              textContent: content.text_content,
            }
            setAttachments([attachment])
            rememberAttachments([attachment])
          } catch {
            // Material is a convenience here — the session itself still runs.
          }
        }
        setTutorSession(session)
        setCurrentStep('tutor')
      } catch {
        sessionStorage.removeItem(TUTOR_SESSION_KEY)
      }
    })()
    return () => { cancelled = true }
  }, [rememberAttachments])

  // Ingestion runs in the module store, not here, so neither of these touches
  // `loading` — that flag means "a generation/tutor/pretest/quiz operation is
  // running" and nothing else. Attaching a source must never disable the bar.
  //
  // Both return immediately; the store reports per-source progress on its own
  // chip and calls back through `onResolved` below.
  const handleAttachFile = useCallback((selectedFile: File) => {
    const name = selectedFile.name.toLowerCase()
    if (!/\.(pdf|docx|pptx)$/.test(name)) {
      throw new Error('Supported file types are .pdf, .docx and .pptx')
    }
    setError('')
    ingestStore.startFile(selectedFile)
  }, [])

  // Attach a link (YouTube video, article, direct media). Deliberately the
  // same shape as handleAttachFile: ingestion produces a document, and from
  // there nothing downstream knows or cares that it came from a URL.
  const handleAttachUrl = useCallback((url: string) => {
    const trimmed = url.trim()
    if (!trimmed) return
    setError('')
    ingestStore.startUrl(trimmed)
  }, [])

  // Apply an ingest that finished while this component was mounted. The store
  // has already persisted the document id, so an ingest that resolves while
  // the student is on /review is picked up by the restore effect instead —
  // only the overlap warning and truncation notice are lost in that case, and
  // both describe a specific upload rather than the material itself.
  useEffect(() => ingestStore.onResolved((r) => {
    removedIdsRef.current.delete(r.documentId)
    const attachment: Attachment = {
      documentId: r.documentId,
      filename: r.filename,
      textContent: r.textContent,
    }
    setAttachments(prev => {
      const next = [...prev.filter(a => a.documentId !== attachment.documentId), attachment]
      rememberAttachments(next)
      return next
    })
    if (r.similarDocuments && r.similarDocuments.length > 0) {
      setSimilarDocuments(r.similarDocuments)
    }
    // A long lecture exceeds the extraction budget; say so plainly rather
    // than letting the student study a silently shortened transcript.
    if (r.truncated) {
      setError(
        `"${r.filename}" was long, so only the first part was kept. ` +
        `Study material is generated from that portion.`
      )
    }
  }), [rememberAttachments])

  // Attach an existing library document — the same action as uploading, minus
  // the upload, so it lands in exactly the same place.
  const handleAttachDocument = useCallback(async (docId: string) => {
    setError('')
    removedIdsRef.current.delete(docId)
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
    removedIdsRef.current.add(docId)
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
      (o): o is 'summary' | 'flashcards' | 'quiz' | 'podcast' =>
        o === 'summary' || o === 'flashcards' || o === 'quiz' || o === 'podcast'
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
    setPodcast(null)
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
      if (output === 'podcast') {
        // A podcast resolving successfully does not imply playable audio —
        // the response carries the script with audio_url null when synthesis
        // failed. That is a success for this row's purposes; the player says
        // what went wrong with the audio.
        return run(
          'podcast',
          (id) => api.generatePodcast(
            textContent, formData.subjectName, formData.podcastLength,
            documentId, id, focusNote,
          ),
          setPodcast,
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

  // Voice roleplay (ROADMAP_HONEN 4). Scenario generation is a 10-30s LLM
  // pipeline, so it uses the same progress-polling UX as the tutor start; the
  // websocket only attaches once the session exists.
  const handleStartRoleplay = useCallback(async () => {
    if (!textContent || !formData.subjectName) return

    setLoading(true)
    setError('')

    const progressId = crypto.randomUUID()
    const stopPolling = pollProgress(progressId)
    try {
      const session = await api.startRoleplay(
        formData.subjectName,
        sources.length > 0
          ? sources
          : [{ text_content: textContent, filename: formData.subjectName, document_id: documentId }],
        undefined,
        progressId,
        documentId
      )
      setRoleplaySession(session)
      setCurrentStep('roleplay')
    } catch (err) {
      setError(err instanceof APIError ? err.message : 'Failed to start roleplay')
    } finally {
      stopPolling()
      setLoading(false)
    }
  }, [textContent, formData, pollProgress, documentId, sources])

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
  const dispatchStart = useCallback(() => {
    if (formData.outputs.includes('pretest')) {
      void handleStartPretest()
      return
    }
    void handleGenerate()
  }, [formData.outputs, handleStartPretest, handleGenerate])

  const handleStart = useCallback(() => {
    // Sources still ingesting: queue the run instead of blocking the button.
    // Deliberately does NOT await here and then call handleGenerate — that
    // captured closure's `textContent` would predate the resolutions, and its
    // `if (!textContent) return` guard makes the button do nothing at all,
    // with no error. The effect below re-reads from a fresh render instead.
    if (pendingRunning > 0) {
      setQueuedSubmit(true)
      return
    }
    dispatchStart()
  }, [pendingRunning, dispatchStart])

  // Fire the queued run once nothing is still ingesting. `attachments` is in
  // the dependency list so this waits for the resolved sources to actually be
  // in state, not merely for the jobs to leave the store.
  useEffect(() => {
    if (!queuedSubmit || pendingRunning > 0) return
    setQueuedSubmit(false)
    if (attachments.length === 0) {
      // Every queued source failed. Starting a generation with no material
      // would produce nothing; the failed chips carry their own errors.
      setError('Nothing was attached — those sources could not be added.')
      return
    }
    dispatchStart()
  }, [queuedSubmit, pendingRunning, attachments, dispatchStart])

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
    setPodcast(null)
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
        onAttachUrl={handleAttachUrl}
        onAttachDocument={handleAttachDocument}
        onRemoveAttachment={handleRemoveAttachment}
        onStart={handleStart}
        loading={loading}
        queuedSubmit={queuedSubmit}
        error={error}
        progressStage={progressStage}
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
          onBack={() => setCurrentStep('upload')}
          loading={loading}
          progressStage={progressStage}
        />
      </main>
    )
  } else if (currentStep === 'roleplay' && roleplaySession) {
    return (
      <main className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center mb-10">
          <h1 className="font-serif text-4xl sm:text-5xl font-light text-white mb-4">
            Explain it <span className="italic text-[#D7FF3D]">out loud</span>
          </h1>
          <p className="text-lg text-white/60 font-sans font-light">
            {formData.subjectName} — talk someone through it, and find out what you actually know
          </p>
        </div>
        <RoleplayView
          key={roleplaySession.session_id}
          session={roleplaySession}
          onExit={() => {
            setRoleplaySession(null)
            setCurrentStep('upload')
          }}
          onPracticeAgain={() => handleStartRoleplay()}
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
            setCurrentStep(summary || quiz || flashcards || podcast ? 'lesson' : 'upload')
          }}
          resetApp={resetApp}
          onPracticeConcepts={handlePracticeConcepts}
          onSessionComplete={() => sessionStorage.removeItem(TUTOR_SESSION_KEY)}
        />
      </main>
    )
  } else if (loading && currentStep === 'lesson') {
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
        podcast={podcast}
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
        onStartRoleplay={handleStartRoleplay}
        setCurrentStep={setCurrentStep}
        resetApp={resetApp}
      />
    )
  }
}
