'use client'

import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import { RotateCcw, ArrowLeft } from 'lucide-react'
import { StudyBar, Attachment } from './StudyBar'
import { DocumentLibrary } from './DocumentLibrary'
import { ReviewDeck } from './ReviewDeck'
import { ConceptReviewBanner } from './ConceptReviewBanner'
import { DueConceptReview, StudyFormData } from '@/types'

const LIME = 'text-[#D7FF3D]'

interface UploadStepProps {
  formData: StudyFormData
  setFormData: React.Dispatch<React.SetStateAction<StudyFormData>>
  attachments: Attachment[]
  onAttachFile: (file: File) => Promise<void>
  onAttachDocument: (documentId: string) => Promise<void>
  onRemoveAttachment: (documentId: string) => void
  onStart: () => void
  loading: boolean
  error: string
  // Live stage of the extraction pipeline ("Describing diagrams and
  // figures (4 of 12 pages)") — replaces the frozen "Processing file..." text.
  progressStage?: string
  resetApp: () => void
  // Starts a short concept-filtered tutor session on a due concept's
  // source document (concept spaced repetition).
  onStartRefresher: (review: DueConceptReview) => Promise<void>
}

// The app's entry screen. Everything needed to start studying lives on the
// study bar — attaching material, saying what to focus on, and choosing what
// to generate are one decision, not a screen each.
export function UploadStep({
  formData,
  setFormData,
  attachments,
  onAttachFile,
  onAttachDocument,
  onRemoveAttachment,
  onStart,
  loading,
  error,
  progressStage,
  resetApp,
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
        <div className="text-center mb-8">
          <h1 className="font-serif text-4xl sm:text-5xl font-light text-white mb-4">
            What are you <span className={`italic ${LIME}`}>studying</span>?
          </h1>
          <p className="text-lg text-white/60 font-sans font-light">
            Add your notes, slides or readings — then tell us what to make from them
          </p>
        </div>

        <StudyBar
          formData={formData}
          setFormData={setFormData}
          attachments={attachments}
          onAttachFile={onAttachFile}
          onRemoveAttachment={onRemoveAttachment}
          onStart={onStart}
          loading={loading}
          progressStage={progressStage}
          error={error}
        />

        {/* Spaced repetition: cards due for review greet returning users */}
        <ReviewDeck />

        {/* Concept spaced repetition: mastered concepts come back as
            one-click tutor refreshers when their review interval lapses */}
        <ConceptReviewBanner onStartRefresher={onStartRefresher} />

        {/* Documents library: past uploads, addable to the bar above */}
        <DocumentLibrary
          attachedIds={attachments.map(a => a.documentId)}
          onAdd={onAttachDocument}
          onRemove={onRemoveAttachment}
        />

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
