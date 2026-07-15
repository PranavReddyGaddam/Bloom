'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { DueFlashcard, ReviewGrade } from '@/types'
import { FlashcardItem } from './FlashcardItem'
import { BookOpen, Check } from 'lucide-react'

const LIME = 'text-[#D7FF3D]'
const LIME_BG = 'bg-[#D7FF3D]'

const GRADES: { value: ReviewGrade; label: string; hint: string }[] = [
  { value: 'again', label: 'Again', hint: 'forgot it' },
  { value: 'hard', label: 'Hard', hint: 'barely' },
  { value: 'good', label: 'Good', hint: 'got it' },
  { value: 'easy', label: 'Easy', hint: 'instantly' },
]

// Spaced repetition review (ROADMAP 4.1): shows cards whose SM-2 schedule
// says they're due, one at a time; each self-graded review pushes the card
// out at a growing interval. Rendered on the upload (landing) page so the
// due count greets returning users.
export function ReviewDeck() {
  const [cards, setCards] = useState<DueFlashcard[]>([])
  const [totalDue, setTotalDue] = useState(0)
  const [index, setIndex] = useState(0)
  const [reviewing, setReviewing] = useState(false)
  const [grading, setGrading] = useState(false)
  const [reviewedCount, setReviewedCount] = useState(0)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const due = await api.getDueFlashcards()
        if (!cancelled) {
          setCards(due.cards)
          setTotalDue(due.total_due)
        }
      } catch {
        // Review is an extra — a fetch failure just hides the section.
      } finally {
        if (!cancelled) setLoaded(true)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const handleGrade = useCallback(async (grade: ReviewGrade) => {
    const card = cards[index]
    if (!card || grading) return
    setGrading(true)
    try {
      await api.reviewFlashcard(card.id, grade)
      setReviewedCount(count => count + 1)
      setIndex(i => i + 1)
    } catch {
      // Failed to record — keep the card up so the review isn't lost.
    } finally {
      setGrading(false)
    }
  }, [cards, index, grading])

  if (!loaded || totalDue === 0) return null

  const current = cards[index]

  if (!reviewing) {
    return (
      <div className="mt-10 rounded-2xl border border-[#D7FF3D]/30 bg-[#D7FF3D]/[0.06] backdrop-blur-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <BookOpen className={`h-5 w-5 shrink-0 ${LIME}`} />
            <div>
              <p className="text-white font-medium font-sans">
                {totalDue} flashcard{totalDue === 1 ? '' : 's'} due for review
              </p>
              <p className="text-sm text-white/50">
                A few minutes now keeps them from fading
              </p>
            </div>
          </div>
          <Button onClick={() => setReviewing(true)} className={`${LIME_BG} text-black hover:bg-[#c2e836]`}>
            Review now
          </Button>
        </div>
      </div>
    )
  }

  if (!current) {
    return (
      <div className="mt-10 rounded-2xl border border-[#D7FF3D]/30 bg-[#D7FF3D]/[0.06] backdrop-blur-xl p-6 text-center">
        <Check className={`h-8 w-8 mx-auto mb-2 ${LIME}`} />
        <p className="text-white font-medium font-sans mb-1">All caught up</p>
        <p className="text-sm text-white/50">
          You reviewed {reviewedCount} card{reviewedCount === 1 ? '' : 's'} — they&apos;ll come back when they&apos;re due again.
        </p>
      </div>
    )
  }

  return (
    <div className="mt-10">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-medium text-white font-sans">Review — {current.subject}</h2>
        <span className="text-sm text-white/50 tabular-nums">
          {index + 1} / {cards.length}
        </span>
      </div>

      <FlashcardItem
        key={current.id}
        card={{ front: current.front, back: current.back, category: current.category ?? undefined }}
      />

      <p className="text-sm text-white/50 text-center mt-6 mb-3">
        Flip the card, then grade how well you remembered it
      </p>
      <div className="flex justify-center gap-3">
        {GRADES.map(grade => (
          <button
            key={grade.value}
            type="button"
            onClick={() => handleGrade(grade.value)}
            disabled={grading}
            className={`px-4 py-2 rounded-xl border text-sm transition-colors disabled:opacity-50 ${
              grade.value === 'again'
                ? 'border-red-400/40 bg-red-500/10 text-red-200 hover:bg-red-500/20'
                : grade.value === 'easy'
                  ? 'border-[#D7FF3D]/50 bg-[#D7FF3D]/10 text-[#D7FF3D] hover:bg-[#D7FF3D]/20'
                  : 'border-white/20 bg-white/5 text-white hover:bg-white/10'
            }`}
          >
            <span className="font-medium">{grade.label}</span>
            <span className="block text-xs opacity-60">{grade.hint}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
