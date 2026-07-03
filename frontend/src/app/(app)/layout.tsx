'use client'

import { PageBackground } from '@/components/PageBackground'
import { RecentQuizzesSidebar } from '@/components/RecentQuizzesSidebar'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen relative flex">
      <PageBackground />
      <div className="relative z-10">
        <RecentQuizzesSidebar />
      </div>
      <div className="relative z-10 flex-1 min-w-0">
        {children}
      </div>
    </div>
  )
}
