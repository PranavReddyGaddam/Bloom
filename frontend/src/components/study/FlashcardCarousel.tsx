'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { FlashcardItem } from './FlashcardItem'

// Displays one flashcard at a time with prev/next navigation
export function FlashcardCarousel({ cards }: { cards: { front: string; back: string; category?: string }[] }) {
  const [index, setIndex] = useState(0)

  const goPrev = () => setIndex((i) => (i - 1 + cards.length) % cards.length)
  const goNext = () => setIndex((i) => (i + 1) % cards.length)

  if (cards.length === 0) return null

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="w-full max-w-2xl">
        <FlashcardItem key={index} card={cards[index]} />
      </div>

      <div className="flex items-center gap-6">
        <Button
          variant="outline"
          size="icon"
          onClick={goPrev}
          className="border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white rounded-full"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        <span className="text-sm text-white/60 font-sans tabular-nums">
          {index + 1} / {cards.length}
        </span>

        <Button
          variant="outline"
          size="icon"
          onClick={goNext}
          className="border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white rounded-full"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
