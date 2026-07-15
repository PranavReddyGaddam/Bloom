'use client'

import { forwardRef, useRef, type ReactNode, type RefObject } from 'react'
import { FileText, Layers, Target, GraduationCap, Flower2 } from 'lucide-react'
import { AnimatedBeam } from '@/components/ui/animated-beam'

const LIME = '#D7FF3D'

const Node = forwardRef<
  HTMLDivElement,
  { children: ReactNode; label?: string; size?: 'md' | 'lg' }
>(({ children, label, size = 'md' }, ref) => (
  <div className="flex flex-col items-center gap-2">
    <div
      ref={ref}
      className={`z-10 flex items-center justify-center rounded-full border border-white/15 bg-white/10 backdrop-blur-md ${
        size === 'lg'
          ? 'h-16 w-16 shadow-[0_0_40px_rgba(215,255,61,0.25)]'
          : 'h-12 w-12'
      }`}
    >
      {children}
    </div>
    {label && (
      <span className="text-xs font-medium text-white/60 text-center">{label}</span>
    )}
  </div>
))
Node.displayName = 'Node'

export function PipelineBeam() {
  const containerRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLDivElement>(null)
  const bloomRef = useRef<HTMLDivElement>(null)
  const flashcardsRef = useRef<HTMLDivElement>(null)
  const quizRef = useRef<HTMLDivElement>(null)
  const guideRef = useRef<HTMLDivElement>(null)
  const tutorRef = useRef<HTMLDivElement>(null)

  const outputs: Array<{
    ref: RefObject<HTMLDivElement | null>
    icon: typeof Layers
    label: string
    curvature: number
    delay: number
  }> = [
    { ref: flashcardsRef, icon: Layers, label: 'Flashcards', curvature: 160, delay: 0.6 },
    { ref: quizRef, icon: Target, label: 'Practice Test', curvature: 60, delay: 1.1 },
    { ref: guideRef, icon: FileText, label: 'Study Guide', curvature: -60, delay: 1.6 },
    { ref: tutorRef, icon: GraduationCap, label: 'Tutor Session', curvature: -160, delay: 2.1 },
  ]

  return (
    <div
      ref={containerRef}
      className="relative flex h-[24rem] w-full items-center justify-between px-2 sm:px-8"
    >
      <Node ref={fileRef} label="Biology_101.pdf">
        <FileText className="h-5 w-5 text-white/80" />
      </Node>

      <Node ref={bloomRef} size="lg">
        <Flower2 className="h-7 w-7" style={{ color: LIME }} />
      </Node>

      <div className="flex h-full flex-col justify-between py-4">
        {outputs.map(({ ref, icon: Icon, label }) => (
          <Node key={label} ref={ref} label={label}>
            <Icon className="h-5 w-5" style={{ color: LIME }} />
          </Node>
        ))}
      </div>

      <AnimatedBeam
        containerRef={containerRef}
        fromRef={fileRef}
        toRef={bloomRef}
        pathColor="white"
        pathOpacity={0.12}
        gradientStartColor={LIME}
        gradientStopColor="#86efac"
        duration={4}
      />
      {outputs.map(({ ref, label, curvature, delay }) => (
        <AnimatedBeam
          key={label}
          containerRef={containerRef}
          fromRef={bloomRef}
          toRef={ref}
          curvature={curvature}
          delay={delay}
          pathColor="white"
          pathOpacity={0.12}
          gradientStartColor={LIME}
          gradientStopColor="#86efac"
          duration={4}
        />
      ))}
    </div>
  )
}
