'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { DueConceptReview } from '@/types'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import { TUTOR_SESSION_KEY } from '@/components/BloomApp'
import { ReviewDeck } from '@/components/study/ReviewDeck'
import { ConceptReviewBanner } from '@/components/study/ConceptReviewBanner'
import { Check } from 'lucide-react'

const LIME = 'text-[#D7FF3D]'

// Everything waiting to be reviewed, in one place: flashcards whose SM-2
// schedule says they're due, and concepts due for a tutor refresher. Both used
// to sit on the upload screen, where they competed with the study bar for
// attention — pending work is its own intent, not a thing to trip over on the
// way to starting something new.
export default function ReviewPage() {
  const router = useRouter()
  const [dueCards, setDueCards] = useState<number | null>(null)
  const [dueConcepts, setDueConcepts] = useState<number | null>(null)

  useEffect(() => {
    api.getDueFlashcards().then(d => setDueCards(d.total_due)).catch(() => setDueCards(0))
    api.getDueConcepts().then(d => setDueConcepts(d.concepts.length)).catch(() => setDueConcepts(0))
  }, [])

  // A refresher is a tutor session. Start it here, then hand off to the study
  // screen — BloomApp resumes any live session from sessionStorage on mount,
  // which is the same path a page refresh mid-session already takes.
  const handleStartRefresher = useCallback(async (review: DueConceptReview) => {
    const content = await api.getDocumentContent(review.document_id)
    const subjectName = review.subject || review.concept
    const session = await api.startTutorSession(
      content.text_content,
      subjectName,
      'vibe_check',
      [review.concept],
      undefined,
      content.id
    )
    sessionStorage.setItem(TUTOR_SESSION_KEY, JSON.stringify({
      id: session.session_id,
      subjectName,
      // Carried so the study screen can load this document as the active
      // material when the refresher ends.
      documentId: content.id,
    }))
    router.push('/upload')
  }, [router])

  // Both counts loaded and both zero: nothing is pending.
  const allClear = dueCards === 0 && dueConcepts === 0

  return (
    <div>
      <header className="relative z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-end items-center py-4">
            <ProfileAvatar />
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="mb-4">
          <h1 className="font-serif text-4xl sm:text-5xl font-light text-white mb-3">
            Ready to <span className={`italic ${LIME}`}>review</span>
          </h1>
          <p className="text-lg text-white/60 font-sans font-light">
            What&apos;s due to come back before it fades
          </p>
        </div>

        {allClear ? (
          <div className="mt-10 rounded-2xl border border-white/15 bg-white/[0.06] backdrop-blur-xl p-10 text-center">
            <Check className={`h-8 w-8 mx-auto mb-3 ${LIME}`} />
            <p className="text-white font-sans mb-1">Nothing due right now</p>
            <p className="text-sm text-white/50">
              Cards and concepts come back here on their own schedule — check in tomorrow.
            </p>
          </div>
        ) : (
          <>
            {/* Both components self-hide when their own queue is empty. */}
            <ReviewDeck />
            <ConceptReviewBanner onStartRefresher={handleStartRefresher} />
          </>
        )}
      </main>
    </div>
  )
}
