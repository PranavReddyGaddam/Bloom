'use client'

import { useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { api, APIError } from '@/lib/api'
import {
  SummaryResponse,
  QuizResponse,
  QuizResult,
  UserAnswer,
  FlashcardResponse,
  StudyFormData,
  Difficulty
} from '@/types'
import { UploadStep } from '@/components/study/UploadStep'
import { ConfigureStep } from '@/components/study/ConfigureStep'
import { ResultsStep } from '@/components/study/ResultsStep'

interface BloomAppProps {
  initialStep?: 'upload' | 'configure' | 'results'
}

export default function BloomApp({ initialStep = 'upload' }: BloomAppProps) {
  const router = useRouter()

  // File input ref
  const fileInputRef = useRef<HTMLInputElement>(null)

  // State management
  const [file, setFile] = useState<File | null>(null)
  const [textContent, setTextContent] = useState<string>('')
  const [pastedText, setPastedText] = useState<string>('')
  const [flashcardPdfFile, setFlashcardPdfFile] = useState<File | null>(null)
  const [flashcardPdfContent, setFlashcardPdfContent] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>('')
  const [summary, setSummary] = useState<SummaryResponse | null>(null)
  const [quiz, setQuiz] = useState<QuizResponse | null>(null)
  const [flashcards, setFlashcards] = useState<FlashcardResponse | null>(null)
  const [quizResult, setQuizResult] = useState<QuizResult | null>(null)
  const [userAnswers, setUserAnswers] = useState<UserAnswer[]>([])
  const [currentStep, setCurrentStep] = useState<'upload' | 'configure' | 'results'>(initialStep)
  const [activeTab, setActiveTab] = useState('upload-files')
  const [flashcardActiveTab, setFlashcardActiveTab] = useState('upload-pdf')
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

    setFile(selectedFile)
    setError('')
    setLoading(true)

    try {
      const result = await api.uploadPDF(selectedFile)
      setTextContent(result.text_content)
      setCurrentStep('configure')
    } catch (err) {
      setError(err instanceof APIError ? err.message : 'Failed to upload PDF')
    } finally {
      setLoading(false)
    }
  }, [])

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
    setFile(null)
    setTextContent('')
    setPastedText('')
    setFlashcardPdfFile(null)
    setFlashcardPdfContent('')
    setSummary(null)
    setQuiz(null)
    setFlashcards(null)
    setQuizResult(null)
    setUserAnswers([])
    setCurrentStep('upload')
    setActiveTab('upload-files')
    setError('')

    // Reset URL to upload page
    router.push('/upload')
  }, [router])

  // Add separate reset function for flashcards
  const resetFlashcards = useCallback(() => {
    setFlashcards(null)
    setPastedText('')
    setFlashcardPdfFile(null)
    setFlashcardPdfContent('')
    setError('')
  }, [])

  if (currentStep === 'upload') {
    return (
      <UploadStep
        fileInputRef={fileInputRef}
        file={file}
        textContent={textContent}
        pastedText={pastedText}
        setPastedText={setPastedText}
        flashcardPdfFile={flashcardPdfFile}
        flashcardPdfContent={flashcardPdfContent}
        setFlashcardPdfFile={setFlashcardPdfFile}
        setFlashcardPdfContent={setFlashcardPdfContent}
        loading={loading}
        setLoading={setLoading}
        error={error}
        setError={setError}
        flashcards={flashcards}
        setFlashcards={setFlashcards}
        resetFlashcards={resetFlashcards}
        formData={formData}
        setFormData={setFormData}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        flashcardActiveTab={flashcardActiveTab}
        setFlashcardActiveTab={setFlashcardActiveTab}
        handleFileUpload={handleFileUpload}
        setTextContent={setTextContent}
        setCurrentStep={setCurrentStep}
        resetApp={resetApp}
      />
    )
  } else if (currentStep === 'configure') {
    return (
      <ConfigureStep
        formData={formData}
        setFormData={setFormData}
        loading={loading}
        handleGenerate={handleGenerate}
        setCurrentStep={setCurrentStep}
        resetApp={resetApp}
      />
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
