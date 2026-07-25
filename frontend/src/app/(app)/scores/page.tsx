'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, APIError } from '@/lib/api'
import { RecentAttempt } from '@/types'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import { Trophy, ChevronRight } from 'lucide-react'

const LIME = 'text-[#D7FF3D]'

// Every past quiz attempt, newest first. This replaced the bare percentages
// that used to sit in the sidebar: the same numbers, but with the subject,
// difficulty and date that make them mean something, and each row opens the
// full question-by-question recap.
export default function ScoresPage() {
  const router = useRouter()
  const [attempts, setAttempts] = useState<RecentAttempt[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    api.getMyRecentAttempts(200)
      .then(setAttempts)
      .catch((err) => setError(err instanceof APIError ? err.message : 'Failed to load your scores'))
      .finally(() => setLoading(false))
  }, [])

  const stats = useMemo(() => {
    if (attempts.length === 0) return null
    const total = attempts.reduce((sum, a) => sum + a.score, 0)
    return {
      count: attempts.length,
      average: Math.round(total / attempts.length),
      best: Math.round(Math.max(...attempts.map(a => a.score))),
    }
  }, [attempts])

  // Lime for a strong pass, amber mid, red low — the same reading the quiz
  // results view gives a single attempt, applied down the list.
  const scoreTone = (score: number) =>
    score >= 80 ? 'text-[#D7FF3D]' : score >= 50 ? 'text-amber-300' : 'text-red-300'

  return (
    <div>
      <header className="relative z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-end items-center py-4">
            <ProfileAvatar />
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="mb-10">
          <h1 className="font-serif text-4xl sm:text-5xl font-light text-white mb-3">
            Your <span className={`italic ${LIME}`}>scores</span>
          </h1>
          <p className="text-lg text-white/60 font-sans font-light">
            Every quiz you&apos;ve taken — open one to see it question by question
          </p>
        </div>

        {error && (
          <div className="p-4 bg-red-500/10 border border-red-400/30 rounded-xl text-red-200 text-sm mb-6">
            {error}
          </div>
        )}

        {stats && (
          <div className="grid grid-cols-3 gap-4 mb-8">
            {[
              { label: 'Quizzes taken', value: stats.count },
              { label: 'Average score', value: `${stats.average}%` },
              { label: 'Best score', value: `${stats.best}%` },
            ].map(stat => (
              <div
                key={stat.label}
                className="rounded-2xl border border-white/15 bg-white/[0.06] backdrop-blur-xl p-5"
              >
                <p className="text-sm text-white/50 mb-1">{stat.label}</p>
                <p className="text-2xl font-medium text-white tabular-nums">{stat.value}</p>
              </div>
            ))}
          </div>
        )}

        {loading ? (
          <div className="text-white/50 text-sm">Loading…</div>
        ) : attempts.length === 0 && !error ? (
          <div className="rounded-2xl border border-white/15 bg-white/[0.06] backdrop-blur-xl p-10 text-center">
            <Trophy className="h-8 w-8 mx-auto mb-3 text-white/30" />
            <p className="text-white font-sans mb-1">No quizzes yet</p>
            <p className="text-sm text-white/50">
              Scores show up here once you&apos;ve taken your first quiz.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {attempts.map(attempt => (
              <li key={attempt.id}>
                <button
                  type="button"
                  onClick={() => router.push(`/quiz/${attempt.id}`)}
                  className="w-full flex items-center gap-4 rounded-xl border border-white/15 bg-white/[0.04] backdrop-blur-xl p-4 text-left hover:border-white/30 hover:bg-white/[0.07] transition-colors"
                >
                  <span className={`text-xl font-medium tabular-nums shrink-0 w-14 ${scoreTone(attempt.score)}`}>
                    {Math.round(attempt.score)}%
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-white truncate">{attempt.subject}</span>
                    <span className="block text-sm text-white/40 capitalize">
                      {attempt.difficulty} · {attempt.total_questions} questions ·{' '}
                      {new Date(attempt.created_at).toLocaleDateString()}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 text-white/30 shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}
