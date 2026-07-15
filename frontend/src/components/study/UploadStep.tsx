'use client'

import { RefObject } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Progress } from '@/components/ui/progress'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import {
  FileText,
  X,
  RotateCcw,
  ArrowLeft,
  File,
  Presentation
} from 'lucide-react'
import { DocumentLibrary } from './DocumentLibrary'
import { ReviewDeck } from './ReviewDeck'
import { ConceptReviewBanner } from './ConceptReviewBanner'
import { DueConceptReview } from '@/types'

const LIME = 'text-[#D7FF3D]'

interface UploadStepProps {
  fileInputRef: RefObject<HTMLInputElement | null>
  file: { name: string; size: number } | null
  loading: boolean
  error: string
  // Live stage of the extraction pipeline ("Describing diagrams and
  // figures (4 of 12 pages)") — replaces the frozen "Processing file..." text.
  progressStage?: string
  handleFileUpload: (event: React.ChangeEvent<HTMLInputElement>) => void
  removeFile: () => void
  resetApp: () => void
  // Makes a stored upload the active material ("study this again").
  onOpenDocument: (documentId: string) => Promise<void>
  // Starts a short concept-filtered tutor session on a due concept's
  // source document (concept spaced repetition).
  onStartRefresher: (review: DueConceptReview) => Promise<void>
}

export function UploadStep({
  fileInputRef,
  file,
  loading,
  error,
  progressStage,
  handleFileUpload,
  removeFile,
  resetApp,
  onOpenDocument,
  onStartRefresher
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
            Upload your <span className={`italic ${LIME}`}>study materials</span>
          </h1>
          <p className="text-lg text-white/60 font-sans font-light">
            Then choose how you want to study — flashcards, a practice quiz, or both
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <Alert className="mb-6 border-red-400/30 bg-red-500/10">
            <X className="h-4 w-4 text-red-300" />
            <AlertDescription className="text-red-200">{error}</AlertDescription>
          </Alert>
        )}

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
              <button
                type="button"
                onClick={removeFile}
                aria-label="Remove file"
                className="shrink-0 text-white/50 hover:text-white transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {loading && (
            <div className="mt-4">
              <Progress value={50} className="w-64 mx-auto bg-white/10" />
              <p className="text-sm text-white/50 mt-2" aria-live="polite">
                {progressStage || 'Processing file...'}
              </p>
            </div>
          )}
        </div>

        {/* Spaced repetition: cards due for review greet returning users */}
        <ReviewDeck />

        {/* Concept spaced repetition: mastered concepts come back as
            one-click tutor refreshers when their review interval lapses */}
        <ConceptReviewBanner onStartRefresher={onStartRefresher} />

        {/* Documents library: past uploads, re-studiable without the file */}
        <DocumentLibrary onOpen={onOpenDocument} />

        {/* Footer */}
        <footer className="mt-16 py-8 border-t border-white/10">
          <div className="text-center">
            <p className="text-sm text-white/30">
              © 2026 Bloom. All rights reserved.
            </p>
          </div>
        </footer>
      </main>
    </div>
  )
}
