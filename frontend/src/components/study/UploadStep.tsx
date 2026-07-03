'use client'

import { RefObject } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Progress } from '@/components/ui/progress'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import { api } from '@/lib/api'
import { StudyFormData, SummaryType, CardType, FlashcardResponse, Subject } from '@/types'
import {
  Upload,
  FileText,
  Check,
  X,
  RotateCcw,
  BookOpen,
  ArrowLeft,
  File,
  Presentation
} from 'lucide-react'
import { SubjectSelect } from './SubjectSelect'
import { FlashcardCarousel } from './FlashcardCarousel'

const LIME = 'text-[#D7FF3D]'
const LIME_BG = 'bg-[#D7FF3D]'

interface UploadStepProps {
  fileInputRef: RefObject<HTMLInputElement | null>
  file: File | null
  textContent: string
  pastedText: string
  setPastedText: (value: string) => void
  flashcardPdfFile: File | null
  flashcardPdfContent: string
  setFlashcardPdfFile: (file: File | null) => void
  setFlashcardPdfContent: (content: string) => void
  loading: boolean
  setLoading: (loading: boolean) => void
  error: string
  setError: (error: string) => void
  flashcards: FlashcardResponse | null
  setFlashcards: (flashcards: FlashcardResponse | null) => void
  resetFlashcards: () => void
  formData: StudyFormData
  setFormData: React.Dispatch<React.SetStateAction<StudyFormData>>
  activeTab: string
  setActiveTab: (tab: string) => void
  flashcardActiveTab: string
  setFlashcardActiveTab: (tab: string) => void
  handleFileUpload: (event: React.ChangeEvent<HTMLInputElement>) => void
  setTextContent: (content: string) => void
  setCurrentStep: (step: 'upload' | 'configure' | 'results') => void
  resetApp: () => void
}

export function UploadStep({
  fileInputRef,
  file,
  textContent,
  pastedText,
  setPastedText,
  flashcardPdfFile,
  flashcardPdfContent,
  setFlashcardPdfFile,
  setFlashcardPdfContent,
  loading,
  setLoading,
  error,
  setError,
  flashcards,
  setFlashcards,
  resetFlashcards,
  formData,
  setFormData,
  activeTab,
  setActiveTab,
  flashcardActiveTab,
  setFlashcardActiveTab,
  handleFileUpload,
  setTextContent,
  setCurrentStep,
  resetApp
}: UploadStepProps) {
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
                onClick={() => router.push('/')}
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
                  // Reset all state and reload the page
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
            Generate a <span className={`italic ${LIME}`}>practice test</span>
          </h1>
          <p className="text-lg text-white/60 font-sans font-light">
            Choose or upload materials to generate practice questions designed for you
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <Alert className="mb-6 border-red-400/30 bg-red-500/10">
            <X className="h-4 w-4 text-red-300" />
            <AlertDescription className="text-red-200">{error}</AlertDescription>
          </Alert>
        )}

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-8 bg-white/5 border border-white/10 backdrop-blur-xl p-1 h-auto rounded-xl">
            <TabsTrigger
              value="flashcard-sets"
              className="text-sm text-white/60 data-[state=active]:bg-white/10 data-[state=active]:text-white data-[state=active]:shadow-none rounded-lg py-2"
            >
              Flashcard sets
            </TabsTrigger>
            <TabsTrigger
              value="upload-files"
              className="text-sm text-white/60 data-[state=active]:bg-white/10 data-[state=active]:text-white data-[state=active]:shadow-none rounded-lg py-2"
            >
              Upload files
            </TabsTrigger>
            <TabsTrigger
              value="paste-text"
              className="text-sm text-white/60 data-[state=active]:bg-white/10 data-[state=active]:text-white data-[state=active]:shadow-none rounded-lg py-2"
            >
              Paste text
            </TabsTrigger>
          </TabsList>

          {/* Upload Files Tab */}
          <TabsContent value="upload-files" className="space-y-8">
            {/* Upload Area */}
            <div className="border-2 border-dashed border-white/20 rounded-2xl p-16 text-center hover:border-[#D7FF3D]/40 transition-colors bg-white/[0.03] backdrop-blur-xl">
              {/* File Type Icons */}
              <div className="flex justify-center space-x-4 mb-6">
                <div className="w-12 h-12 bg-white/10 border border-white/10 rounded-lg flex items-center justify-center">
                  <File className="h-6 w-6 text-white/70" />
                </div>
                <div className="w-12 h-12 bg-white/10 border border-white/10 rounded-lg flex items-center justify-center">
                  <FileText className="h-6 w-6 text-white/70" />
                </div>
                <div className="w-12 h-12 bg-white/10 border border-white/10 rounded-lg flex items-center justify-center">
                  <Presentation className="h-6 w-6 text-white/70" />
                </div>
              </div>

              <h3 className="text-xl font-medium text-white mb-2 font-sans">
                Drag and drop notes, readings, lecture slides, etc.
              </h3>
              <p className="text-sm text-white/50 mb-6">
                Supported file types are .docx, .pdf, .pptx
              </p>

              <Label htmlFor="file-upload" className="cursor-pointer">
                <Button
                  variant="outline"
                  className="mb-4 border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Browse files
                </Button>
                <Input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx,.pptx"
                  onChange={handleFileUpload}
                  className="hidden"
                  disabled={loading}
                />
              </Label>

              {file && (
                <div className="mt-4 mx-auto w-fit max-w-full p-3 bg-white/10 border border-white/10 rounded-lg flex items-center gap-2">
                  <FileText className={`h-4 w-4 ${LIME} shrink-0`} />
                  <span className="text-sm text-white/80 truncate">{file.name}</span>
                  <Badge variant="outline" className="text-xs border-white/20 text-white/60 shrink-0">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </Badge>
                </div>
              )}

              {loading && (
                <div className="mt-4">
                  <Progress value={50} className="w-64 mx-auto bg-white/10" />
                  <p className="text-sm text-white/50 mt-2">Processing file...</p>
                </div>
              )}
            </div>
          </TabsContent>

          {/* Other Tabs - Placeholder */}
          <TabsContent value="flashcard-sets" className="py-8">
            <div className="max-w-4xl mx-auto">
              <div className="text-center mb-8">
                <BookOpen className={`h-12 w-12 mx-auto mb-4 ${LIME}`} />
                <h3 className="font-serif text-2xl font-light text-white mb-2">
                  Create Flashcard Set
                </h3>
                <p className="text-lg text-white/60 font-sans font-light">
                  Generate interactive flashcards from your study materials
                </p>
              </div>

              {/* Flashcard Tabs */}
              <Tabs value={flashcardActiveTab} onValueChange={setFlashcardActiveTab} className="w-full">
                <TabsList className="grid w-full grid-cols-2 mb-8 bg-white/5 border border-white/10 backdrop-blur-xl p-1 h-auto rounded-xl">
                  <TabsTrigger
                    value="upload-pdf"
                    className="text-white/60 data-[state=active]:bg-white/10 data-[state=active]:text-white data-[state=active]:shadow-none rounded-lg py-2"
                  >
                    Upload PDF
                  </TabsTrigger>
                  <TabsTrigger
                    value="paste-text"
                    className="text-white/60 data-[state=active]:bg-white/10 data-[state=active]:text-white data-[state=active]:shadow-none rounded-lg py-2"
                  >
                    Paste Text
                  </TabsTrigger>
                </TabsList>

                {/* Upload PDF Tab */}
                <TabsContent value="upload-pdf" className="space-y-6">
                  {!flashcardPdfContent ? (
                    // PDF Upload Area
                    <div className="border-2 border-dashed border-white/20 rounded-2xl p-12 text-center hover:border-[#D7FF3D]/40 transition-colors bg-white/[0.03] backdrop-blur-xl">
                      <Upload className="h-12 w-12 mx-auto mb-4 text-white/40" />
                      <h4 className="text-lg font-medium text-white mb-2 font-sans">
                        Upload your PDF
                      </h4>
                      <p className="text-sm text-white/50 mb-6">
                        Drag and drop or click to browse
                      </p>

                      <input
                        type="file"
                        accept=".pdf"
                        onChange={async (e) => {
                          const selectedFile = e.target.files?.[0]
                          if (!selectedFile) return

                          if (selectedFile.type !== 'application/pdf') {
                            setError('Please select a PDF file')
                            return
                          }

                          setFlashcardPdfFile(selectedFile)
                          setError('')
                          setLoading(true)

                          try {
                            const result = await api.uploadPDF(selectedFile)
                            setFlashcardPdfContent(result.text_content)
                          } catch (err) {
                            setError(err instanceof Error ? err.message : 'Failed to upload PDF')
                          } finally {
                            setLoading(false)
                          }
                        }}
                        className="hidden"
                        id="flashcard-pdf-input"
                        disabled={loading}
                      />

                      <Label htmlFor="flashcard-pdf-input" className="cursor-pointer">
                        <Button variant="outline" asChild className="border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white">
                          <span>
                            {loading ? (
                              <>
                                <div className="animate-spin h-4 w-4 mr-2 border-2 border-white/60 border-t-transparent rounded-full" />
                                Processing...
                              </>
                            ) : (
                              'Browse Files'
                            )}
                          </span>
                        </Button>
                      </Label>

                      {flashcardPdfFile && (
                        <div className="mt-4 mx-auto w-fit max-w-full p-3 bg-white/10 border border-white/10 rounded-lg flex items-center gap-2">
                          <FileText className={`h-4 w-4 ${LIME} shrink-0`} />
                          <span className="text-sm text-white/80 truncate">{flashcardPdfFile.name}</span>
                          <Badge variant="outline" className="text-xs border-white/20 text-white/60 shrink-0">
                            {(flashcardPdfFile.size / 1024 / 1024).toFixed(2)} MB
                          </Badge>
                        </div>
                      )}
                    </div>
                  ) : (
                    // Configuration and Generation Interface
                    <div>
                      <div className="mb-6 p-4 bg-[#D7FF3D]/10 border border-[#D7FF3D]/20 rounded-xl">
                        <div className="flex items-center gap-2 text-[#D7FF3D]">
                          <Check className="h-5 w-5" />
                          <span className="font-medium">PDF processed successfully</span>
                        </div>
                        <p className="text-sm text-white/60 mt-1">
                          {flashcardPdfContent.length} characters extracted • Ready to generate flashcards
                        </p>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
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
                            onValueChange={(value: CardType) =>
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

                      <div className="flex justify-between items-center">
                        <Button
                          variant="outline"
                          className="border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white"
                          onClick={() => {
                            setFlashcardPdfFile(null)
                            setFlashcardPdfContent('')
                            setFlashcards(null)
                          }}
                        >
                          Upload Different PDF
                        </Button>

                        <Button
                          onClick={async () => {
                            setFlashcards(null)
                            setError('')
                            setLoading(true)

                            try {
                              const flashcardsResult = await api.generateFlashcards(
                                flashcardPdfContent,
                                formData.numCards,
                                formData.subjectName,
                                formData.cardType
                              )
                              setFlashcards(flashcardsResult)
                            } catch (err) {
                              setError(err instanceof Error ? err.message : 'Failed to generate flashcards')
                            } finally {
                              setLoading(false)
                            }
                          }}
                          disabled={loading}
                          className={`${LIME_BG} text-black hover:bg-[#c2e836]`}
                        >
                          {loading ? (
                            <>
                              <div className="animate-spin h-4 w-4 mr-2 border-2 border-black/60 border-t-transparent rounded-full" />
                              Generating...
                            </>
                          ) : (
                            'Generate Flashcards'
                          )}
                        </Button>
                      </div>
                    </div>
                  )}
                </TabsContent>

                {/* Paste Text Tab */}
                <TabsContent value="paste-text" className="space-y-6">
                  <div>
                    <textarea
                      value={pastedText}
                      onChange={(e) => setPastedText(e.target.value)}
                      placeholder="Enter or paste your study material here... (e.g., lecture notes, definitions, concepts)"
                      className="w-full h-48 p-4 border border-white/20 bg-white/5 text-white placeholder:text-white/30 rounded-xl focus:ring-2 focus:ring-[#D7FF3D]/40 focus:border-[#D7FF3D]/40 resize-vertical outline-none"
                      disabled={loading}
                    />

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
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
                          onValueChange={(value: CardType) =>
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

                    <div className="flex items-center justify-between mt-6">
                      <div className="text-sm text-white/40">
                        {pastedText.length > 0 && (
                          <span>{pastedText.length} characters • {pastedText.split(/\s+/).filter(word => word.length > 0).length} words</span>
                        )}
                      </div>

                      <div className="flex space-x-3">
                        <Button
                          onClick={async () => {
                            if (!pastedText.trim()) {
                              setError('Please enter some text content')
                              return
                            }

                            setFlashcards(null)
                            setError('')
                            setLoading(true)

                            try {
                              const flashcardsResult = await api.generateFlashcards(
                                pastedText.trim(),
                                formData.numCards,
                                formData.subjectName,
                                formData.cardType
                              )
                              setFlashcards(flashcardsResult)
                            } catch (err) {
                              setError(err instanceof Error ? err.message : 'Failed to generate flashcards')
                            } finally {
                              setLoading(false)
                            }
                          }}
                          disabled={!pastedText.trim() || loading}
                          className={`${LIME_BG} text-black hover:bg-[#c2e836]`}
                        >
                          {loading ? (
                            <>
                              <div className="animate-spin h-4 w-4 mr-2 border-2 border-black/60 border-t-transparent rounded-full" />
                              Generating...
                            </>
                          ) : (
                            'Generate Flashcards'
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>

              {/* Display Generated Flashcards */}
              {flashcards && (
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
                        onClick={resetFlashcards}
                        size="sm"
                        className="border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white"
                      >
                        Create New Set
                      </Button>
                    </div>

                    <FlashcardCarousel cards={flashcards.flashcards} />
                  </div>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="paste-text" className="text-center py-16">
            <div className="max-w-2xl mx-auto">
              <div className="text-center mb-6">
                <FileText className={`h-12 w-12 mx-auto mb-4 ${LIME}`} />
                <h3 className="font-serif text-2xl font-light text-white mb-2">
                  Paste Text Content
                </h3>
                <p className="text-sm text-white/50">
                  Enter or paste your text content to generate study materials
                </p>
              </div>

              <div className="text-left">
                <textarea
                  value={pastedText}
                  onChange={(e) => setPastedText(e.target.value)}
                  placeholder="Paste your study material here... (e.g., lecture notes, textbook content, articles)"
                  className="w-full h-48 p-4 border border-white/20 bg-white/5 text-white placeholder:text-white/30 rounded-xl focus:ring-2 focus:ring-[#D7FF3D]/40 focus:border-[#D7FF3D]/40 resize-vertical outline-none"
                  disabled={loading}
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                  <SubjectSelect
                    labelHtmlFor="paste-subject"
                    subjectId={formData.subjectId}
                    onSelect={(subject: Subject) =>
                      setFormData(prev => ({ ...prev, subjectId: subject.id, subjectName: subject.name }))
                    }
                  />

                  <div className="space-y-2">
                    <Label htmlFor="paste-summary-type" className="text-sm font-medium text-white/70">Summary Format</Label>
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
                    <Label htmlFor="paste-num-questions" className="text-sm font-medium text-white/70">Number of Questions</Label>
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
                    <Label htmlFor="paste-difficulty" className="text-sm font-medium text-white/70">Difficulty Level</Label>
                    <Select
                      value={formData.difficulty}
                      onValueChange={(value: 'easy' | 'medium' | 'hard') =>
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

                <div className="flex items-center justify-between mt-6">
                  <div className="text-sm text-white/40">
                    {pastedText.length > 0 && (
                      <span>{pastedText.length} characters • {pastedText.split(/\s+/).filter(word => word.length > 0).length} words</span>
                    )}
                  </div>

                  <div className="flex space-x-3">
                    <Button
                      onClick={() => {
                        if (!pastedText.trim()) {
                          setError('Please enter some text content')
                          return
                        }

                        // Set the text content and move to configure step
                        setTextContent(pastedText.trim())
                        setCurrentStep('configure')
                        router.push('/upload?step=configure')
                      }}
                      disabled={!pastedText.trim() || loading}
                      className={`${LIME_BG} text-black hover:bg-[#c2e836]`}
                    >
                      Generate Study Materials
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        {/* Footer */}
        <footer className="mt-16 py-8 border-t border-white/10">
          <div className="text-center">
            <p className="text-sm text-white/30">
              © 2026 Bloom. All rights reserved.
            </p>
          </div>
        </footer>
      </main>

      {/* Generate Button */}
      {textContent && (
        <div className="fixed bottom-6 right-6 z-20">
          <Button
            onClick={() => {
              setCurrentStep('configure')
              router.push('/upload?step=configure')
            }}
            size="lg"
            className={`${LIME_BG} text-black hover:bg-[#c2e836] px-8 py-3 rounded-full shadow-lg`}
          >
            Continue
          </Button>
        </div>
      )}
    </div>
  )
}
