import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { BookOpen } from 'lucide-react'
import { SummaryResponse } from '@/types'
import { formatSummaryContent, parseConcepts } from './summaryFormatting'

export function SummaryView({ summary }: { summary: SummaryResponse }) {
  return (
    <div className="bg-white/[0.06] backdrop-blur-xl rounded-2xl border border-white/15 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-serif text-3xl font-light text-white">Generated Summary</h3>
        <Badge variant="outline" className="capitalize border-white/20 text-white/70">
          {summary.summary_type.replace('_', ' ')}
        </Badge>
      </div>

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
                  {concepts.map((concept, i) => (
                    <div
                      key={concept.title}
                      className="bg-white/5 border border-white/10 rounded-xl p-5"
                    >
                      <div className="flex items-start gap-3 mb-2">
                        <span className="text-xs font-medium text-[#D7FF3D] mt-1 shrink-0">
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <h4 className="font-serif text-xl font-light text-white leading-snug">
                          {concept.title}
                        </h4>
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
                  ))}
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
