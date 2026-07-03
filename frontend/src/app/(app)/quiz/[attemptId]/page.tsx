'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { api, APIError } from '@/lib/api'
import { AttemptRecap } from '@/types'
import { ArrowLeft, Check, X } from 'lucide-react'

const LIME_BG = 'bg-[#D7FF3D]'

export default function AttemptRecapPage() {
  const router = useRouter()
  const params = useParams<{ attemptId: string }>()
  const [recap, setRecap] = useState<AttemptRecap | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getAttemptRecap(params.attemptId)
      .then(setRecap)
      .catch((err) => setError(err instanceof APIError ? err.message : 'Failed to load quiz'))
      .finally(() => setLoading(false))
  }, [params.attemptId])

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => router.back()}
        className="text-white/60 hover:text-white hover:bg-white/10 mb-6"
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back
      </Button>

      {loading ? (
        <div className="text-white/50 text-sm">Loading...</div>
      ) : error ? (
        <div className="p-4 bg-red-500/10 border border-red-400/30 rounded-xl text-red-200 text-sm">{error}</div>
      ) : recap && (
        <>
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 mb-6">
            <div className="flex items-center justify-between mb-2">
              <h1 className="font-serif text-2xl font-light text-white">{recap.subject}</h1>
              <div className="text-2xl font-bold text-[#D7FF3D]">{Math.round(recap.score)}%</div>
            </div>
            <p className="text-white/50 text-sm capitalize">
              {recap.difficulty} • {recap.total_questions} questions • {new Date(recap.created_at).toLocaleDateString()}
            </p>
          </div>

          <div className="space-y-3">
            {recap.questions.map((q) => (
              <div
                key={q.question_index}
                className={`p-4 rounded-xl border-2 ${
                  q.is_correct ? 'border-[#D7FF3D]/30 bg-[#D7FF3D]/5' : 'border-red-400/30 bg-red-500/5'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-sm font-medium ${
                    q.is_correct ? `${LIME_BG} text-black` : 'bg-red-500 text-white'
                  }`}>
                    {q.is_correct ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                  </div>
                  <div className="flex-1">
                    <h5 className="font-medium text-white mb-2">
                      {q.question_index + 1}. {q.question_text}
                    </h5>
                    <div className="space-y-2 text-sm">
                      <div className={`p-2 rounded-lg ${
                        q.is_correct ? 'bg-[#D7FF3D]/10 text-[#D7FF3D]' : 'bg-red-500/10 text-red-300'
                      }`}>
                        <span className="font-medium">Your answer: </span>
                        {q.user_answer || 'No answer selected'}
                      </div>
                      {!q.is_correct && (
                        <div className="p-2 rounded-lg bg-[#D7FF3D]/10 text-[#D7FF3D]">
                          <span className="font-medium">Correct answer: </span>
                          {q.correct_answer}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
