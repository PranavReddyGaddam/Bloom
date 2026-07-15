'use client'

import { useState } from 'react'
import { MathText } from './MathText'

// Flashcard component with flip functionality
export function FlashcardItem({ card }: { card: { front: string; back: string; category?: string } }) {
  const [isFlipped, setIsFlipped] = useState(false)

  return (
    <div
      className="relative cursor-pointer"
      style={{
        perspective: '1000px',
        minHeight: '400px',
        height: 'auto'
      }}
      onClick={() => setIsFlipped(!isFlipped)}
    >
      <div
        className={`relative w-full transition-transform duration-700 ease-in-out`}
        style={{
          transformStyle: 'preserve-3d',
          transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
          minHeight: '400px'
        }}
      >
        {/* Front of card */}
        <div
          className="absolute inset-0 w-full"
          style={{
            backfaceVisibility: 'hidden',
            minHeight: '400px'
          }}
        >
          <div className="h-full p-8 bg-gradient-to-br from-indigo-500 to-blue-600 rounded-2xl text-white shadow-lg border border-white/10 hover:shadow-xl transition-shadow flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs text-white/70 font-medium uppercase tracking-wide">Question</div>
              {card.category && (
                <div className="text-xs bg-white/20 px-2 py-1 rounded text-white/90">
                  {card.category}
                </div>
              )}
            </div>

            {/* Content */}
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="text-2xl font-medium leading-relaxed break-words hyphens-auto overflow-hidden">
                  {card.front.length > 300 ? (
                    <div className="max-h-64 overflow-y-auto pr-2 text-lg leading-snug">
                      <MathText text={card.front} />
                    </div>
                  ) : (
                    <MathText text={card.front} />
                  )}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="mt-3 text-center">
              <div className="text-xs text-white/60">Click to reveal answer</div>
            </div>
          </div>
        </div>

        {/* Back of card */}
        <div
          className="absolute inset-0 w-full"
          style={{
            backfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
            minHeight: '400px'
          }}
        >
          <div className="h-full p-8 bg-gradient-to-br from-emerald-500 to-green-600 rounded-2xl text-white shadow-lg border border-white/10 hover:shadow-xl transition-shadow flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs text-white/70 font-medium uppercase tracking-wide">Answer</div>
              {card.category && (
                <div className="text-xs bg-white/20 px-2 py-1 rounded text-white/90">
                  {card.category}
                </div>
              )}
            </div>

            {/* Content */}
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="text-2xl font-medium leading-relaxed break-words hyphens-auto overflow-hidden">
                  {card.back.length > 300 ? (
                    <div className="max-h-64 overflow-y-auto pr-2 text-lg leading-snug">
                      <MathText text={card.back} />
                    </div>
                  ) : (
                    <MathText text={card.back} />
                  )}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="mt-3 text-center">
              <div className="text-xs text-white/60">Click to see question</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
