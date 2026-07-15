'use client'

import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import Grainient from '@/components/Grainient'
import { FeatureAccordion, type AccordionFeature } from '@/components/FeatureAccordion'
import { PipelineBeam } from '@/components/PipelineBeam'
import { HeroOrbit } from '@/components/HeroOrbit'
import {
  Layers,
  Target,
  Upload,
  ArrowRight,
  ArrowUpRight,
  ScanSearch,
  PenLine,
  ShieldCheck,
  Check,
} from 'lucide-react'

const FEATURES: AccordionFeature[] = [
  {
    icon: Upload,
    num: '01',
    title: 'Smart Upload',
    description: 'Upload slides, notes, or documents and Bloom reads every page — diagrams, charts, and equations included, described by vision AI instead of being dropped.',
    points: ['PDF, DOCX & PPTX support', 'Diagrams and equations understood, not skipped', 'Key concepts extracted automatically'],
  },
  {
    icon: Layers,
    num: '02',
    title: 'Summaries & Flashcards',
    description: 'Study material that checks itself: every summary is drafted, critiqued against your source, and revised before you see it — with flashcard decks generated alongside.',
    points: ['Concept-grouped summaries', 'Self-critiqued against your material', 'Flashcard decks in one click'],
  },
  {
    icon: ShieldCheck,
    num: '03',
    title: 'Grounded Quizzes',
    description: 'Every question is fact-checked against your material before it reaches you, so you never study a hallucination. Explanations and analytics come built in.',
    points: ['Answers verified against your source', 'Per-question explanations', 'Performance analytics by concept and difficulty'],
  },
  {
    icon: Target,
    num: '04',
    title: 'Adaptive Tutor',
    description: 'A one-on-one session that tracks your mastery of each concept live, targets your weakest one next, and explains why you got an answer wrong — not just that you did.',
    points: ['Per-concept mastery tracking', 'Difficulty calibrated to you, question by question', 'Diagnoses the why behind wrong answers'],
  },
]

const LIME = 'text-[#D7FF3D]'
const LIME_BG = 'bg-[#D7FF3D]'

export default function LandingPage() {
  const router = useRouter()

  const handleNavigateToUpload = () => {
    router.push('/upload')
  }

  return (
    <div className="min-h-screen relative">
      {/* Persistent grainient background */}
      <div className="fixed inset-0 z-0 h-screen w-screen bg-[#0d1230]">
        <Grainient
          timeSpeed={0.2}
          colorBalance={0}
          warpStrength={1}
          warpFrequency={4}
          warpSpeed={1.5}
          warpAmplitude={55}
          blendAngle={0}
          blendSoftness={0.08}
          rotationAmount={400}
          noiseScale={1.6}
          grainAmount={0.09}
          grainScale={2}
          grainAnimated={false}
          contrast={1.35}
          gamma={1}
          saturation={1}
          centerX={0}
          centerY={0}
          zoom={1.1}
          color1="#0d1230"
          color2="#6f93dd"
          color3="#1a2568"
        />
      </div>

      {/* Header */}
      <header className="relative z-10">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex items-center h-20">
            <button
              onClick={() => router.push('/')}
              className="text-xl font-semibold tracking-tight text-white font-sans"
            >
              Bloom
            </button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative z-10 max-w-7xl mx-auto px-6 pt-16 pb-32 grid lg:grid-cols-2 gap-16 items-center">
        <div>
          <h1 className="font-sans text-6xl sm:text-7xl lg:text-8xl font-light text-white leading-[1.05]">
            AI tutor that
            <br />
            <span className={`font-serif italic font-normal ${LIME}`}>remembers</span>
            <br />
            how you learn
          </h1>
          <p className="mt-8 text-xl text-white/70 max-w-md leading-relaxed font-sans font-light">
            Bloom tracks misconceptions, adapts every session, and helps you retain
            knowledge&mdash;not just memorize it.
          </p>
          <div className="mt-10">
            <Button
              onClick={handleNavigateToUpload}
              size="lg"
              className="bg-white/10 border border-white/25 text-white hover:bg-white/20 rounded-xl px-6 h-14 font-medium text-base backdrop-blur-sm inline-flex items-center gap-3 font-sans"
            >
              <Upload className="h-5 w-5" />
              Upload material
            </Button>
          </div>
        </div>

        {/* Orbiting feature icons */}
        <div className="hidden lg:block">
          <HeroOrbit />
        </div>
      </section>

      {/* metric strip — full-bleed, edge to edge */}
      <div className="relative z-10 pb-24 pt-12 font-sans">
        <div className="relative border-y border-white/15 grid grid-cols-2 sm:grid-cols-4 divide-y divide-x-0 sm:divide-y-0 sm:divide-x divide-white/15">
          {/* internal divider junctions (desktop: 1 row, 3 dividers) */}
          <span className="hidden sm:block absolute top-0 left-1/4 -translate-x-1/2 -translate-y-1/2 text-white/40 text-sm leading-none select-none">+</span>
          <span className="hidden sm:block absolute bottom-0 left-1/4 -translate-x-1/2 translate-y-1/2 text-white/40 text-sm leading-none select-none">+</span>
          <span className="hidden sm:block absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 text-white/40 text-sm leading-none select-none">+</span>
          <span className="hidden sm:block absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 text-white/40 text-sm leading-none select-none">+</span>
          <span className="hidden sm:block absolute top-0 left-3/4 -translate-x-1/2 -translate-y-1/2 text-white/40 text-sm leading-none select-none">+</span>
          <span className="hidden sm:block absolute bottom-0 left-3/4 -translate-x-1/2 translate-y-1/2 text-white/40 text-sm leading-none select-none">+</span>
          {/* internal junctions (mobile: 2x2 grid — center cross) */}
          <span className="sm:hidden absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-white/40 text-sm leading-none select-none">+</span>
          {[
            ['100%', 'of quiz questions fact-checked against your material'],
            ['4', 'study modes in one platform'],
            ['3', 'file formats supported — PDF, DOCX, PPTX'],
            ['5', 'concepts tracked live in every tutor session'],
          ].map(([stat, label]) => (
            <div key={stat} className="p-6 text-center">
              <div className="text-3xl sm:text-4xl font-semibold text-white">{stat}</div>
              <div className="text-sm text-white/60 leading-relaxed mt-2">{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Feature list */}
      <section className="relative z-10 px-6 py-28 font-sans">
        <div className="max-w-5xl mx-auto">
          <div className="max-w-xl mb-20">
            <h2 className="font-serif text-4xl md:text-5xl font-light text-white mb-5 leading-tight">
              Everything you need to <span className={`italic ${LIME}`}>actually</span> retain it
            </h2>
            <p className="text-lg text-white/60 leading-relaxed font-light">
              Four ways to turn material into memory, all generated automatically.
            </p>
          </div>

          <FeatureAccordion features={FEATURES} onSelect={handleNavigateToUpload} />
        </div>
      </section>

      {/* Split showcase */}
      <section className="relative z-10 px-6 py-28 border-t border-white/10 font-sans">
        <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-16 items-center">
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-white/40">How it works</span>
            <h2 className="font-serif text-4xl md:text-5xl font-light text-white mt-4 mb-6 leading-tight">
              Not one AI call. <span className={`italic ${LIME}`}>An agent pipeline</span>
            </h2>
            <p className="text-lg text-white/60 mb-9 leading-relaxed max-w-md font-light">
              Bloom reads every page of your material, drafts study content, critiques its own
              draft against your source, and verifies every quiz question before it ever reaches you.
            </p>
            <Button
              onClick={handleNavigateToUpload}
              variant="outline"
              className="rounded-full px-6 h-11 border-white/25 bg-transparent text-white hover:bg-white/10"
            >
              Try it out
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="rounded-3xl border border-white/15 bg-white/[0.06] backdrop-blur-xl p-8 font-sans">
            <div className="flex items-center justify-between mb-6">
              <span className="text-xs font-medium text-white/40 uppercase tracking-wide">
                Agent pipeline
              </span>
              <span className={`text-xs font-medium ${LIME}`}>Biology_101.pdf</span>
            </div>

            <div className="space-y-3">
              <div className="rounded-xl bg-white/5 border border-white/10 p-4 flex items-start gap-3">
                <div className={`h-7 w-7 rounded-lg ${LIME_BG}/15 flex items-center justify-center shrink-0 mt-0.5`}>
                  <ScanSearch className={`h-3.5 w-3.5 ${LIME}`} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-white">Extract & classify</span>
                    <Check className={`h-3.5 w-3.5 ${LIME} shrink-0`} />
                  </div>
                  <p className="text-sm text-white/50 leading-relaxed">
                    24 pages read — 3 diagrams sent to a vision model for description.
                  </p>
                </div>
              </div>

              <div className="rounded-xl bg-white/5 border border-white/10 p-4 flex items-start gap-3">
                <div className={`h-7 w-7 rounded-lg ${LIME_BG}/15 flex items-center justify-center shrink-0 mt-0.5`}>
                  <PenLine className={`h-3.5 w-3.5 ${LIME}`} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-white">Draft & self-critique</span>
                    <Check className={`h-3.5 w-3.5 ${LIME} shrink-0`} />
                  </div>
                  <p className="text-sm text-white/50 leading-relaxed">
                    Flagged 2 vague explanations, revised against the source text.
                  </p>
                </div>
              </div>

              <div className="rounded-xl bg-white/5 border border-white/10 p-4 flex items-start gap-3">
                <div className={`h-7 w-7 rounded-lg ${LIME_BG}/15 flex items-center justify-center shrink-0 mt-0.5`}>
                  <ShieldCheck className={`h-3.5 w-3.5 ${LIME}`} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-white">Ground & verify</span>
                    <Check className={`h-3.5 w-3.5 ${LIME} shrink-0`} />
                  </div>
                  <p className="text-sm text-white/50 leading-relaxed">
                    Every quiz question checked against the source; 1 regenerated.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-xl bg-white/10 px-5 py-3.5 flex items-center justify-between mt-4">
              <span className="text-xs font-medium text-white/80">Study set ready — Biology 101</span>
              <ArrowUpRight className="h-3.5 w-3.5 text-white/60" />
            </div>
          </div>
        </div>
      </section>

      {/* CTA banner */}
      <section className="relative z-10 px-6 py-28">
        <div className="max-w-7xl mx-auto">
          <div className="rounded-3xl border border-white/15 bg-white/[0.06] backdrop-blur-xl px-8 py-16 sm:px-16 relative overflow-hidden">
            <div className={`absolute top-0 right-0 h-72 w-72 rounded-full ${LIME_BG} opacity-20 blur-3xl -translate-y-1/2 translate-x-1/3`} />

            <div className="grid lg:grid-cols-2 gap-14 items-center relative">
              <div>
                <h2 className="font-serif text-4xl md:text-5xl font-light text-white mb-6 leading-tight">
                  One upload. <span className={`italic ${LIME}`}>Every</span> way to study.
                </h2>
                <p className="text-lg text-white/60 mb-9 max-w-md leading-relaxed font-sans font-light">
                  Bloom turns whatever you give it — slides, notes, a textbook chapter — into
                  flashcards, a practice test, a study guide, and a live tutor session, all
                  grounded in that one source.
                </p>
                <Button
                  onClick={handleNavigateToUpload}
                  size="lg"
                  className={`${LIME_BG} text-black hover:bg-[#c2e836] rounded-full px-7 h-12 font-medium text-base font-sans`}
                >
                  Get started
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>

              <PipelineBeam />
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/10 py-14 font-sans">
        <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-base font-medium text-white">Bloom</div>
          <p className="text-sm text-white/50">
            AI-powered learning platform for the modern student
          </p>
          <p className="text-xs text-white/30">
            © 2026 Bloom. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  )
}
