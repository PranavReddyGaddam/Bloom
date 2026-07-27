'use client'

import { Target, User } from 'lucide-react'
import type { RoleplayScenario } from '@/types'

const LIME = 'text-[#D7FF3D]'

/**
 * The scene setup, visible throughout the conversation.
 *
 * The rubric criteria are shown up front, by name. That is deliberate
 * pedagogy rather than a leak: knowing what a good explanation covers is what
 * makes the practice worth doing. What stays server-side is each criterion's
 * `evidence` — the specific source fact that makes it checkable — which is the
 * actual answer key.
 */
export function ScenarioBrief({ scenario }: { scenario: RoleplayScenario }) {
  return (
    <div className="bg-white/[0.06] backdrop-blur-xl rounded-2xl border border-white/15 p-6">
      {scenario.title && (
        <h2 className="font-serif text-2xl font-light text-white mb-4">
          {scenario.title}
        </h2>
      )}

      {scenario.character && (
        <div className="flex items-start gap-3 mb-4">
          <User className={`h-4 w-4 mt-1 shrink-0 ${LIME}`} />
          <div>
            <div className="text-sm text-white">{scenario.character.name}</div>
            <div className="text-sm text-white/50">{scenario.character.role}</div>
          </div>
        </div>
      )}

      {scenario.situation && (
        <p className="text-sm text-white/60 leading-relaxed mb-4">
          {scenario.situation}
        </p>
      )}

      {scenario.student_role && (
        <p className="text-sm text-white/50 mb-6">
          <span className="text-white/70">You&rsquo;re playing:</span>{' '}
          {scenario.student_role}
        </p>
      )}

      {scenario.rubric.length > 0 && (
        <div className="pt-4 border-t border-white/10">
          <div className="flex items-center gap-2 mb-3">
            <Target className={`h-4 w-4 ${LIME}`} />
            <span className="text-sm text-white/70">What to cover</span>
          </div>
          <ul className="space-y-2">
            {scenario.rubric.map((criterion) => (
              <li key={criterion.id} className="text-sm text-white/60 flex gap-2">
                <span className="text-white/25 shrink-0">&middot;</span>
                <span>{criterion.name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
