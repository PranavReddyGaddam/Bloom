'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Image from 'next/image'
import { api } from '@/lib/api'
import { PanelLeft, Check, Trophy, RefreshCw, Upload } from 'lucide-react'

type SidebarMode = 'expanded' | 'collapsed' | 'hover'

const STORAGE_KEY = 'bloom_sidebar_mode'

const LIME = 'text-[#D7FF3D]'

// App navigation. This used to list raw quiz percentages, which were numbers
// without context — unreadable when collapsed, and meaningless next to each
// other. Past scores now live on their own page; the sidebar just points there
// and carries a badge for work that is actually pending.
export function AppSidebar() {
  const router = useRouter()
  const pathname = usePathname()
  const [dueCount, setDueCount] = useState(0)
  const [mode, setMode] = useState<SidebarMode>('expanded')
  const [mounted, setMounted] = useState(false)
  const [hovering, setHovering] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // How much is waiting to be reviewed, for the badge. Refetched on navigation
  // so finishing a review session updates the count without a reload.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [cards, concepts] = await Promise.all([
        api.getDueFlashcards().catch(() => null),
        api.getDueConcepts().catch(() => null),
      ])
      if (cancelled) return
      setDueCount((cards?.total_due ?? 0) + (concepts?.concepts.length ?? 0))
    })()
    return () => { cancelled = true }
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

  const navItems = [
    { href: '/upload', label: 'Study', icon: Upload, badge: 0 },
    { href: '/review', label: 'Review', icon: RefreshCw, badge: dueCount },
    { href: '/scores', label: 'Scores', icon: Trophy, badge: 0 },
  ]

  return (
    <aside
      className={`hidden md:flex flex-col ${widthClass} shrink-0 h-screen sticky top-0 border-r border-white/10 bg-black/20 backdrop-blur-xl transition-[width] duration-200 overflow-visible`}
      onMouseEnter={() => mode === 'hover' && setHovering(true)}
      onMouseLeave={() => mode === 'hover' && setHovering(false)}
    >
      <div className="p-4 h-[52px] flex items-center">
        {isVisuallyExpanded ? (
          <button
            onClick={() => router.push('/')}
            className="text-xl font-semibold text-white font-sans truncate"
          >
            Bloom
          </button>
        ) : (
          <button
            onClick={() => router.push('/')}
            title="Bloom"
            className="shrink-0"
          >
            <Image src="/favicon-32.png" alt="Bloom" width={24} height={24} className="rounded" />
          </button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2">
        <div className="space-y-0.5 mt-1">
          {navItems.map(item => {
            const active = pathname === item.href
            const Icon = item.icon
            return (
              <button
                key={item.href}
                onClick={() => router.push(item.href)}
                title={item.label}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  active
                    ? 'bg-white/10 text-white'
                    : 'text-white/60 hover:bg-white/5 hover:text-white'
                } ${isVisuallyExpanded ? '' : 'justify-center'}`}
              >
                <span className="relative shrink-0">
                  <Icon className={`h-[18px] w-[18px] ${active ? LIME : ''}`} />
                  {/* Collapsed, the label is gone — the badge becomes a dot so
                      pending work is still visible at a glance. */}
                  {!isVisuallyExpanded && item.badge > 0 && (
                    <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-[#D7FF3D]" />
                  )}
                </span>
                {isVisuallyExpanded && (
                  <>
                    <span className="truncate">{item.label}</span>
                    {item.badge > 0 && (
                      <span className="ml-auto shrink-0 rounded-full bg-[#D7FF3D] text-black text-xs font-medium px-2 py-0.5 tabular-nums">
                        {item.badge}
                      </span>
                    )}
                  </>
                )}
              </button>
            )
          })}
        </div>
      </nav>

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
