'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { api } from '@/lib/api'
import { RecentAttempt } from '@/types'
import { PanelLeft, Check } from 'lucide-react'

type SidebarMode = 'expanded' | 'collapsed' | 'hover'

const STORAGE_KEY = 'bloom_sidebar_mode'

export function RecentQuizzesSidebar() {
  const router = useRouter()
  const pathname = usePathname()
  const [attempts, setAttempts] = useState<RecentAttempt[]>([])
  const [mode, setMode] = useState<SidebarMode>('expanded')
  const [mounted, setMounted] = useState(false)
  const [hovering, setHovering] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.getMyRecentAttempts().then(setAttempts).catch(() => setAttempts([]))
  }, [pathname])

  useEffect(() => {
    // localStorage doesn't exist during SSR, so the stored mode can only be
    // read after mount — this sync (not a "you might not need an effect" case)
    // is required to avoid a server/client hydration mismatch.
    const stored = window.localStorage.getItem(STORAGE_KEY) as SidebarMode | null
    if (stored === 'expanded' || stored === 'collapsed' || stored === 'hover') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMode(stored)
    }
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted) return
    localStorage.setItem(STORAGE_KEY, mode)
  }, [mode, mounted])

  useEffect(() => {
    if (!menuOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [menuOpen])

  const isVisuallyExpanded = mode === 'expanded' || (mode === 'hover' && hovering)
  const widthClass = isVisuallyExpanded ? 'w-64' : 'w-16'

  const modeOptions: { value: SidebarMode; label: string }[] = [
    { value: 'expanded', label: 'Expanded' },
    { value: 'collapsed', label: 'Collapsed' },
    { value: 'hover', label: 'Expand on hover' },
  ]

  return (
    <aside
      className={`hidden md:flex flex-col ${widthClass} shrink-0 h-screen sticky top-0 border-r border-white/10 bg-black/20 backdrop-blur-xl transition-[width] duration-200 overflow-visible`}
      onMouseEnter={() => mode === 'hover' && setHovering(true)}
      onMouseLeave={() => mode === 'hover' && setHovering(false)}
    >
      <div className="p-4 h-[52px] flex items-center">
        {isVisuallyExpanded && (
          <button
            onClick={() => router.push('/')}
            className="text-xl font-semibold text-white font-sans truncate"
          >
            Bloom
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden px-2">
        {isVisuallyExpanded && (
          <div className="px-2 py-1 text-xs font-medium text-white/30 uppercase tracking-wide">Recent Quizzes</div>
        )}
        <div className="space-y-0.5 mt-1">
          {attempts.length === 0 ? (
            isVisuallyExpanded && <p className="px-3 py-2 text-sm text-white/30">No quizzes yet</p>
          ) : (
            attempts.map((attempt) => (
              <button
                key={attempt.id}
                onClick={() => router.push(`/quiz/${attempt.id}`)}
                title={attempt.subject}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                  pathname === `/quiz/${attempt.id}`
                    ? 'bg-white/10 text-white'
                    : 'text-white/60 hover:bg-white/5 hover:text-white'
                }`}
              >
                {isVisuallyExpanded ? (
                  <>
                    <div className="truncate">{attempt.subject}</div>
                    <div className="text-xs text-white/30">{Math.round(attempt.score)}%</div>
                  </>
                ) : (
                  <div className="text-center text-xs">{Math.round(attempt.score)}</div>
                )}
              </button>
            ))
          )}
        </div>
      </div>

      <div className="p-3 border-t border-white/10 space-y-2">
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            title="Sidebar control"
            className="inline-flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 rounded-lg p-2 transition-colors"
          >
            <PanelLeft className="h-4 w-4 shrink-0" />
          </button>

          {menuOpen && (
            <div className="absolute bottom-full left-0 mb-2 w-48 bg-[#0d1230] border border-white/15 rounded-xl shadow-xl overflow-hidden z-50">
              <div className="px-3 py-2 text-xs text-white/40 border-b border-white/10">Sidebar control</div>
              {modeOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => {
                    setMode(option.value)
                    setMenuOpen(false)
                  }}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-white/80 hover:bg-white/10 transition-colors"
                >
                  {option.label}
                  {mode === option.value && <Check className="h-3.5 w-3.5 text-[#D7FF3D]" />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
