'use client'

import { PageBackground } from '@/components/PageBackground'
import { AppSidebar } from '@/components/AppSidebar'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen relative flex">
      <PageBackground />
      <div className="relative z-10">
        <AppSidebar />
      </div>
      <div className="relative z-10 flex-1 min-w-0">
        {children}
      </div>
    </div>
  )
}
