import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { BookOpen, Target } from 'lucide-react'
import { SummaryResponse } from '@/types'
import { formatSummaryContent, parseConcepts } from './summaryFormatting'

// The pretest's concept names and the summary's concept titles come from
// separate LLM calls, so they rarely match verbatim — match on shared words
// instead ("Cellular Respiration" flags "The Cell Respiration Cycle").
const STOP_WORDS = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'in', 'to', 'for', 'on', 'with', 'how', 'why', 'what'])

function contentWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w))
  )
}

function matchesFlagged(title: string, flagged: string[]): boolean {
  const titleWords = contentWords(title)
  if (titleWords.size === 0) return false
  return flagged.some(concept => {
    const conceptWords = contentWords(concept)
    if (conceptWords.size === 0) return false
    let shared = 0
    for (const w of conceptWords) {
      if (titleWords.has(w)) shared++
    }
    return shared >= Math.min(titleWords.size, conceptWords.size) / 2 && shared > 0
  })
}

export function SummaryView({
  summary,
  flaggedConcepts
}: {
  summary: SummaryResponse
  // Concepts missed on a pretest — visually flagged so the student knows
  // where to pay attention while reading.
  flaggedConcepts?: string[]
}) {
  const flagged = flaggedConcepts ?? []
  return (
    <div className="bg-white/[0.06] backdrop-blur-xl rounded-2xl border border-white/15 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-serif text-3xl font-light text-white">Generated Summary</h3>
        <Badge variant="outline" className="capitalize border-white/20 text-white/70">
          {summary.summary_type.replace('_', ' ')}
        </Badge>
      </div>

      {flagged.length > 0 && (
        <div className="mb-6 rounded-xl border border-[#D7FF3D]/30 bg-[#D7FF3D]/[0.06] p-4">
          <div className="flex items-start gap-3">
            <Target className="h-5 w-5 mt-0.5 shrink-0 text-[#D7FF3D]" />
            <div>
              <p className="text-white font-medium font-sans mb-1">From your pretest — pay attention to these</p>
              <div className="flex flex-wrap gap-2 mt-2">
                {flagged.map(concept => (
                  <span
                    key={concept}
                    className="text-xs px-2.5 py-1 rounded-full border border-[#D7FF3D]/40 bg-[#D7FF3D]/10 text-white"
                  >
                    {concept}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="prose prose-invert max-w-none">
        {summary.summary_type === 'detailed' ? (
          <div className="space-y-2">
            {formatSummaryContent(summary.summary)}
          </div>
        ) : summary.summary_type === 'bullet_points' ? (
          (() => {
            const concepts = parseConcepts(summary.summary)
            if (concepts) {
              return (
                <div className="space-y-4">
                  {concepts.map((concept, i) => {
                    const isFlagged = flagged.length > 0 && matchesFlagged(concept.title, flagged)
                    return (
                      <div
                        key={concept.title}
                        className={`rounded-xl p-5 border ${
                          isFlagged
                            ? 'bg-[#D7FF3D]/[0.06] border-[#D7FF3D]/40'
                            : 'bg-white/5 border-white/10'
                        }`}
                      >
                        <div className="flex items-start gap-3 mb-2">
                          <span className="text-xs font-medium text-[#D7FF3D] mt-1 shrink-0">
                            {String(i + 1).padStart(2, '0')}
                          </span>
                          <h4 className="font-serif text-xl font-light text-white leading-snug">
                            {concept.title}
                          </h4>
                          {isFlagged && (
                            <span className="ml-auto shrink-0 inline-flex items-center gap-1 text-xs text-[#D7FF3D] border border-[#D7FF3D]/40 rounded-full px-2 py-0.5 mt-0.5">
                              <Target className="h-3 w-3" />
                              missed on pretest
                            </span>
                          )}
                        </div>
                        <p className="text-white/70 leading-relaxed mb-3 pl-8">
                          {concept.explanation}
                        </p>
                        {concept.details?.length > 0 && (
                          <ul className="space-y-1.5 pl-8">
                            {concept.details.map((detail, j) => (
                              <li key={j} className="text-sm text-white/50 flex items-start gap-2">
                                <span className="text-white/25 mt-1.5">–</span>
                                <span>{detail}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            }
            return (
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                {formatSummaryContent(summary.summary)}
              </div>
            )
          })()
        ) : (
          <div className="space-y-4">
            {formatSummaryContent(summary.summary)}
          </div>
        )}
      </div>

      <Separator className="my-6 bg-white/10" />

      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-white/60">
          <BookOpen className="h-4 w-4" />
          <span>Key Topics:</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {summary.tags.map((tag, index) => (
            <Badge key={index} variant="secondary" className="text-xs bg-white/10 text-white/80 border border-white/10">
              {tag}
            </Badge>
          ))}
        </div>
      </div>
    </div>
  )
}
