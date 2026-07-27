'use client'

import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import { RotateCcw, ArrowLeft } from 'lucide-react'
import { StudyBar, Attachment } from './StudyBar'
import { DocumentLibrary } from './DocumentLibrary'
import { StudyFormData } from '@/types'

const LIME = 'text-[#D7FF3D]'

interface UploadStepProps {
  formData: StudyFormData
  setFormData: React.Dispatch<React.SetStateAction<StudyFormData>>
  attachments: Attachment[]
  // Ingestion is fire-and-forget — these return as soon as the job is queued,
  // and progress lands on the source's own chip.
  onAttachFile: (file: File) => void
  onAttachUrl: (url: string) => void
  onAttachDocument: (documentId: string) => Promise<void>
  onRemoveAttachment: (documentId: string) => void
  onStart: () => void
  loading: boolean
  // A submit waiting on sources that are still ingesting.
  queuedSubmit?: boolean
  error: string
  // Live stage of the extraction pipeline ("Describing diagrams and
  // figures (4 of 12 pages)") — replaces the frozen "Processing file..." text.
  progressStage?: string
  resetApp: () => void
}

// The app's entry screen. Everything needed to start studying lives on the
// study bar — attaching material, saying what to focus on, and choosing what
// to generate are one decision, not a screen each.
export function UploadStep({
  formData,
  setFormData,
  attachments,
  onAttachFile,
  onAttachUrl,
  onAttachDocument,
  onRemoveAttachment,
  onStart,
  loading,
  queuedSubmit,
  error,
  progressStage,
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
          onAttachUrl={onAttachUrl}
          onRemoveAttachment={onRemoveAttachment}
          onStart={onStart}
          loading={loading}
          queuedSubmit={queuedSubmit}
          progressStage={progressStage}
          error={error}
        />

        {/* Due flashcards and concept refreshers used to sit here; they live
            on /review now, reachable from the sidebar with a pending badge.
            This screen is for starting something new. */}

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
