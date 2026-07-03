'use client'

import { Button } from '@/components/ui/button'
import { PageBackground } from '@/components/PageBackground'
import { createClient } from '@/lib/supabase/client'

const LIME = 'text-[#D7FF3D]'

export default function LoginPage() {
  const handleSignIn = async () => {
    const supabase = createClient()
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
  }

  return (
    <div className="min-h-screen relative flex items-center justify-center">
      <PageBackground />

      <div className="relative z-10 w-full max-w-sm mx-auto px-6 text-center">
        <h1 className="font-serif text-4xl font-light text-white mb-3">
          Welcome to <span className={`italic ${LIME}`}>Bloom</span>
        </h1>
        <p className="text-white/60 mb-10 font-sans">
          Sign in to generate and track your study materials
        </p>

        <Button
          onClick={handleSignIn}
          size="lg"
          className="w-full bg-white text-black hover:bg-white/90 font-sans"
        >
          Continue with Google
        </Button>
      </div>
    </div>
  )
}
