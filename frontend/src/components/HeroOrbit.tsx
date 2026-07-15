'use client'

import type { ReactNode } from 'react'
import {
  Flower2,
  Upload,
  Layers,
  Target,
  FileText,
  GraduationCap,
  ShieldCheck,
  ScanSearch,
  PenLine,
} from 'lucide-react'
import { OrbitingCircles } from '@/components/ui/orbiting-circles'

const LIME = '#D7FF3D'

function Chip({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full w-full items-center justify-center rounded-full border border-white/15 bg-white/10 backdrop-blur-md shadow-lg">
      {children}
    </div>
  )
}

export function HeroOrbit() {
  return (
    <div className="relative flex h-[620px] w-full items-center justify-center">
      {/* orbit paths, drawn manually so they read on the dark background */}
      <svg className="pointer-events-none absolute inset-0 size-full">
        <circle cx="50%" cy="50%" r={135} fill="none" className="stroke-white/10" strokeWidth={1} />
        <circle cx="50%" cy="50%" r={240} fill="none" className="stroke-white/10" strokeWidth={1} />
      </svg>

      {/* center: Bloom */}
      <div className="z-10 flex h-20 w-20 items-center justify-center rounded-full border border-white/20 bg-white/10 backdrop-blur-xl shadow-[0_0_60px_rgba(215,255,61,0.3)]">
        <Flower2 className="h-9 w-9" style={{ color: LIME }} />
      </div>

      {/* inner orbit: the four features (matches the accordion icons) */}
      <OrbitingCircles radius={135} iconSize={64} path={false} duration={24}>
        <Chip>
          <Upload className="h-6 w-6" style={{ color: LIME }} />
        </Chip>
        <Chip>
          <Layers className="h-6 w-6" style={{ color: LIME }} />
        </Chip>
        <Chip>
          <ShieldCheck className="h-6 w-6" style={{ color: LIME }} />
        </Chip>
        <Chip>
          <Target className="h-6 w-6" style={{ color: LIME }} />
        </Chip>
      </OrbitingCircles>

      {/* outer orbit: pipeline stages and outputs (matches the later sections) */}
      <OrbitingCircles radius={240} iconSize={72} path={false} duration={36} reverse>
        <Chip>
          <ScanSearch className="h-7 w-7 text-white/80" />
        </Chip>
        <Chip>
          <PenLine className="h-7 w-7 text-white/80" />
        </Chip>
        <Chip>
          <FileText className="h-7 w-7 text-white/80" />
        </Chip>
        <Chip>
          <GraduationCap className="h-7 w-7 text-white/80" />
        </Chip>
      </OrbitingCircles>
    </div>
  )
}
