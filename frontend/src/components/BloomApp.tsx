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
  TutorStartResponse
} from '@/types'
import { UploadStep } from '@/components/study/UploadStep'
import { ConfigureStep } from '@/components/study/ConfigureStep'
import { ResultsStep } from '@/components/study/ResultsStep'
import { TutorView } from '@/components/study/TutorView'

interface BloomAppProps {
  initialStep?: 'upload' | 'configure' | 'results'
}

export interface UploadedFileInfo {
  name: string
  size: number
}

const STORED_FILE_KEY = 'bloom-uploaded-file'

export default function BloomApp({ initialStep = 'upload' }: BloomAppProps) {
  const router = useRouter()

  // File input ref
  const fileInputRef = useRef<HTMLInputElement>(null)

  // State management
  const [file, setFile] = useState<UploadedFileInfo | null>(null)
  const [textContent, setTextContent] = useState<string>('')
  const [similarDocuments, setSimilarDocuments] = useState<SimilarDocument[]>([])

  // Restore the uploaded file across page refreshes
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORED_FILE_KEY)
      if (stored) {
        const { name, size, textContent: storedText } = JSON.parse(stored)
        setFile({ name, size })
        setTextContent(storedText)
      }
    } catch {
      localStorage.removeItem(STORED_FILE_KEY)
    }
  }, [])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>('')
  const [summary, setSummary] = useState<SummaryResponse | null>(null)
  const [quiz, setQuiz] = useState<QuizResponse | null>(null)
  const [flashcards, setFlashcards] = useState<FlashcardResponse | null>(null)
  const [quizResult, setQuizResult] = useState<QuizResult | null>(null)
  const [userAnswers, setUserAnswers] = useState<UserAnswer[]>([])
  const [currentStep, setCurrentStep] = useState<'upload' | 'configure' | 'results' | 'tutor'>(initialStep)
  const [tutorSession, setTutorSession] = useState<TutorStartResponse | null>(null)
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)

  // Form data
  const [formData, setFormData] = useState<StudyFormData>({
    numQuestions: 5,
    numCards: 10,
    subjectId: null,
    subjectName: '',
    difficulty: 'medium',
    summaryType: 'bullet_points',
    cardType: 'mixed'
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

    try {
      const result = await api.uploadPDF(selectedFile)
      setTextContent(result.text_content)
      setSimilarDocuments(result.similar_documents ?? [])
      localStorage.setItem(STORED_FILE_KEY, JSON.stringify({
        name: selectedFile.name,
        size: selectedFile.size,
        textContent: result.text_content
      }))
      setCurrentStep('configure')
      router.push('/upload?step=configure')
    } catch (err) {
      setError(err instanceof APIError ? err.message : 'Failed to upload PDF')
    } finally {
      setLoading(false)
    }
  }, [router])

  const handleGenerate = useCallback(async () => {
    if (!textContent) {
      return
    }

    setLoading(true)
    setError('')

    try {
      // Generate summary and quiz in parallel
      const [summaryResult, quizResult] = await Promise.all([
        api.generateSummary(textContent, formData.summaryType, formData.subjectName),
        api.generateQuiz(
          textContent,
          formData.numQuestions,
          formData.subjectName,
          formData.difficulty
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
      setLoading(false)
    }
  }, [textContent, formData, router])

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
        formData.cardType
      )
      setFlashcards(result)
    } catch (err) {
      setError(err instanceof APIError ? err.message : 'Failed to generate flashcards')
    } finally {
      setLoading(false)
    }
  }, [textContent, formData])

  const handleStartTutor = useCallback(async () => {
    if (!textContent || !formData.subjectName) {
      return
    }

    setLoading(true)
    setError('')

    try {
      const session = await api.startTutorSession(
        textContent,
        formData.subjectName,
        formData.numQuestions
      )
      setTutorSession(session)
      setCurrentStep('tutor')
    } catch (err) {
      setError(err instanceof APIError ? err.message : 'Failed to start tutor session')
    } finally {
      setLoading(false)
    }
  }, [textContent, formData])

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
    setSimilarDocuments([])
    localStorage.removeItem(STORED_FILE_KEY)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [])

  const resetApp = useCallback(() => {
    setFile(null)
    setTextContent('')
    setSimilarDocuments([])
    localStorage.removeItem(STORED_FILE_KEY)
    setSummary(null)
    setQuiz(null)
    setFlashcards(null)
    setQuizResult(null)
    setUserAnswers([])
    setTutorSession(null)
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
        handleFileUpload={handleFileUpload}
        removeFile={removeFile}
        resetApp={resetApp}
      />
    )
  } else if (currentStep === 'configure') {
    return (
      <ConfigureStep
        formData={formData}
        setFormData={setFormData}
        loading={loading}
        error={error}
        similarDocuments={similarDocuments}
        flashcards={flashcards}
        handleGenerate={handleGenerate}
        handleGenerateFlashcards={handleGenerateFlashcards}
        handleStartTutor={handleStartTutor}
        setCurrentStep={setCurrentStep}
        resetApp={resetApp}
      />
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
          session={tutorSession}
          onExit={() => {
            setTutorSession(null)
            setCurrentStep('configure')
          }}
          resetApp={resetApp}
        />
      </main>
    )
  } else {
    return (
      <ResultsStep
        summary={summary}
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
