'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { DueConceptReview } from '@/types'
import { Brain } from 'lucide-react'

const LIME = 'text-[#D7FF3D]'
const LIME_BG = 'bg-[#D7FF3D]'

// Spaced repetition for concepts (ROADMAP_LEARNING 6): concepts decay like
// flashcards do. Rendered on the upload (landing) page alongside the
// flashcard review deck — one click starts a short tutor refresher on the
// concept's source document, and the refresher reschedules the next review.
export function ConceptReviewBanner({
  onStartRefresher
}: {
  onStartRefresher: (review: DueConceptReview) => Promise<void>
}) {
  const [concepts, setConcepts] = useState<DueConceptReview[]>([])
  const [loaded, setLoaded] = useState(false)
  const [startingId, setStartingId] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const due = await api.getDueConcepts()
        if (!cancelled) setConcepts(due.concepts)
      } catch {
        // Reviews are an extra — a fetch failure just hides the section.
      } finally {
        if (!cancelled) setLoaded(true)
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (!loaded || concepts.length === 0) return null

  const handleStart = async (review: DueConceptReview) => {
    setStartingId(review.id)
    setError('')
    try {
      await onStartRefresher(review)
    } catch {
      setError('Failed to start the refresher — please try again')
      setStartingId(null)
    }
  }

  const ago = (review: DueConceptReview) => {
    const days = review.days_since_seen
    if (days == null) return 'a while ago'
    if (days === 0) return 'earlier today'
    if (days === 1) return 'yesterday'
    return `${days} days ago`
  }

  return (
    <div className="mt-10 rounded-2xl border border-[#D7FF3D]/30 bg-[#D7FF3D]/[0.06] backdrop-blur-xl p-5">
      <div className="flex items-center gap-3 mb-4">
        <Brain className={`h-5 w-5 shrink-0 ${LIME}`} />
        <div>
          <p className="text-white font-medium font-sans">
            Time to refresh {concepts.length === 1 ? 'a concept' : 'some concepts'} before {concepts.length === 1 ? 'it fades' : 'they fade'}
          </p>
          <p className="text-sm text-white/50">
            A few quick questions per concept, pulled from your own material
          </p>
        </div>
      </div>

      <ul className="space-y-3">
        {concepts.map(review => (
          <li
            key={review.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3"
          >
            <div className="min-w-0">
              <p className="text-white truncate">{review.concept}</p>
              <p className="text-sm text-white/50 truncate">
                Last studied {ago(review)}
                {review.document_filename ? ` · ${review.document_filename}` : ''}
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => handleStart(review)}
              disabled={startingId !== null}
              className={`${LIME_BG} text-black hover:bg-[#c2e836] shrink-0`}
            >
              {startingId === review.id ? (
                <>
                  <div className="animate-spin h-4 w-4 mr-2 border-2 border-black/60 border-t-transparent rounded-full" />
                  Preparing...
                </>
              ) : (
                'Refresh it'
              )}
            </Button>
          </li>
        ))}
      </ul>
      {error && <p className="text-sm text-red-300 mt-3">{error}</p>}
    </div>
  )
}
