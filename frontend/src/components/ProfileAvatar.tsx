'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { UserCircle, LogOut } from 'lucide-react'

export function ProfileAvatar() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => setUser(data.user))
  }, [])

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

  const displayName = user?.user_metadata?.full_name || user?.email || 'Profile'
  const avatarUrl = user?.user_metadata?.avatar_url as string | undefined

  const handleSignOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setMenuOpen((v) => !v)}
        title={displayName}
        className={`shrink-0 rounded-full ring-1 transition-all duration-200 ${
          menuOpen ? 'ring-[#D7FF3D]/50 scale-105' : 'ring-white/15 hover:ring-white/30 hover:scale-105'
        }`}
      >
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={displayName}
            className="h-8 w-8 rounded-full object-cover aspect-square"
          />
        ) : (
          <div className="h-8 w-8 rounded-full bg-white/10 flex items-center justify-center text-sm font-serif text-white aspect-square">
            {displayName.charAt(0).toUpperCase()}
          </div>
        )}
      </button>

      <div
        className={`absolute top-full right-0 mt-2 w-44 bg-white/[0.06] backdrop-blur-xl border border-white/15 rounded-xl shadow-xl overflow-hidden z-50 origin-top-right transition-all duration-150 ${
          menuOpen ? 'opacity-100 scale-100 pointer-events-auto' : 'opacity-0 scale-95 pointer-events-none'
        }`}
      >
        <button
          onClick={() => {
            setMenuOpen(false)
            router.push('/profile')
          }}
          className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-white/80 hover:bg-white/10 transition-colors"
        >
          <UserCircle className="h-4 w-4" />
          Profile
        </button>
        <button
          onClick={() => {
            setMenuOpen(false)
            handleSignOut()
          }}
          className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-white/80 hover:bg-white/10 transition-colors border-t border-white/10"
        >
          <LogOut className="h-4 w-4" />
          Log out
        </button>
      </div>
    </div>
  )
}
