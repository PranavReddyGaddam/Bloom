'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { Button } from '@/components/ui/button'
import { SignOutButton } from '@/components/SignOutButton'
import { createClient } from '@/lib/supabase/client'
import { api, APIError } from '@/lib/api'
import { UserStats, UserAnalytics } from '@/types'
import { AnalyticsCharts } from '@/components/study/AnalyticsCharts'
import { ArrowLeft, Award, BookOpen, Target, TrendingUp, TrendingDown } from 'lucide-react'

const LIME = 'text-[#D7FF3D]'
const LIME_BG = 'bg-[#D7FF3D]'

export default function ProfilePage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [stats, setStats] = useState<UserStats | null>(null)
  const [analytics, setAnalytics] = useState<UserAnalytics | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()

    supabase.auth.getUser().then(({ data }) => setUser(data.user))

    Promise.all([api.getMyStats(), api.getMyAnalytics()])
      .then(([statsResult, analyticsResult]) => {
        setStats(statsResult)
        setAnalytics(analyticsResult)
      })
      .catch((err) => setError(err instanceof APIError ? err.message : 'Failed to load stats'))
      .finally(() => setLoading(false))
  }, [])

  const displayName = user?.user_metadata?.full_name || user?.email || 'Student'
  const avatarUrl = user?.user_metadata?.avatar_url as string | undefined

  // Real trend: compare average score of the earlier half of attempts vs.
  // the more recent half — only meaningful with at least 4 attempts.
  let scoreTrendDelta: number | null = null
  if (analytics && analytics.score_trend.length >= 4) {
    const mid = Math.floor(analytics.score_trend.length / 2)
    const earlier = analytics.score_trend.slice(0, mid)
    const recent = analytics.score_trend.slice(mid)
    const avg = (points: typeof earlier) => points.reduce((sum, p) => sum + p.score, 0) / points.length
    scoreTrendDelta = Math.round(avg(recent) - avg(earlier))
  }

  return (
    <div>
      <header className="relative z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center space-x-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push('/upload')}
                className="text-white/60 hover:text-white hover:bg-white/10"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              <span className="text-xl font-semibold text-white font-sans">Bloom</span>
            </div>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Identity */}
        <div className="flex items-center gap-4 mb-10">
          {avatarUrl ? (
            <img src={avatarUrl} alt={displayName} className="h-16 w-16 rounded-full border border-white/15" />
          ) : (
            <div className="h-16 w-16 rounded-full bg-white/10 border border-white/15 flex items-center justify-center text-2xl font-serif text-white">
              {displayName.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <h1 className="font-serif text-3xl font-light text-white">{displayName}</h1>
            {user?.email && <p className="text-white/50 text-sm">{user.email}</p>}
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-400/30 rounded-xl text-red-200 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-white/50 text-sm">Loading stats...</div>
        ) : stats && stats.total_attempts === 0 ? (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-8 text-center">
            <p className="text-white/60 mb-4">You haven&apos;t completed any quizzes yet.</p>
            <Button onClick={() => router.push('/upload')} className={`${LIME_BG} text-black hover:bg-[#c2e836]`}>
              Take your first quiz
            </Button>
          </div>
        ) : stats && (
          <>
            {/* Stat cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
                <div className="flex items-center gap-2 text-white/50 text-sm mb-2">
                  <BookOpen className="h-4 w-4" />
                  Quizzes Taken
                </div>
                <div className="text-3xl font-bold text-white">{stats.total_attempts}</div>
              </div>

              <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 text-white/50 text-sm">
                    <Target className="h-4 w-4" />
                    Average Score
                  </div>
                  {scoreTrendDelta !== null && scoreTrendDelta !== 0 && (
                    <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium ${
                      scoreTrendDelta > 0
                        ? 'bg-[#D7FF3D]/10 text-[#D7FF3D]'
                        : 'bg-red-500/10 text-red-300'
                    }`}>
                      {scoreTrendDelta > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                      {scoreTrendDelta > 0 ? '+' : ''}{scoreTrendDelta}%
                    </div>
                  )}
                </div>
                <div className={`text-3xl font-bold ${LIME}`}>{Math.round(stats.average_score)}%</div>
              </div>

              <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
                <div className="flex items-center gap-2 text-white/50 text-sm mb-2">
                  <Award className="h-4 w-4" />
                  Strongest Topic
                </div>
                <div className="text-xl font-medium text-white truncate">
                  {stats.best_category || '—'}
                </div>
              </div>
            </div>

            {/* Charts */}
            {analytics && (
              <div className="mb-8">
                <AnalyticsCharts analytics={analytics} />
              </div>
            )}

            {/* Recent attempts */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
              <h2 className="font-medium text-white mb-4">Recent Quizzes</h2>
              <div className="space-y-2">
                {stats.recent_attempts.map((attempt) => (
                  <div
                    key={attempt.id}
                    className="flex items-center justify-between p-3 bg-white/[0.03] border border-white/10 rounded-xl"
                  >
                    <div>
                      <div className="text-white text-sm font-medium">{attempt.subject}</div>
                      <div className="text-white/40 text-xs capitalize">
                        {attempt.difficulty} • {new Date(attempt.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="text-sm font-medium text-white">
                      {Math.round(attempt.score)}%
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
