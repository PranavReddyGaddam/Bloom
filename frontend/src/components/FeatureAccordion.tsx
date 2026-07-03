'use client'

import type { LucideIcon } from 'lucide-react'

const LIME = 'text-[#D7FF3D]'

export interface AccordionFeature {
  icon: LucideIcon
  num: string
  title: string
  description: string
  points: string[]
}

export function FeatureAccordion({
  features,
  onSelect,
}: {
  features: AccordionFeature[]
  onSelect?: (feature: AccordionFeature) => void
}) {
  return (
    <div className="border-t border-white/15 font-sans">
      {features.map((feature) => (
        <div key={feature.title} className="group border-b border-white/15">
          <div className="flex items-center gap-6 py-8 cursor-default">
            <span className={`text-sm font-light ${LIME} shrink-0`}>{feature.num}</span>
            <div className="h-12 w-12 rounded-full border border-white/15 flex items-center justify-center shrink-0 transition-colors duration-300 group-hover:border-[#D7FF3D]/60">
              <feature.icon className="h-5 w-5 text-white/50 transition-colors duration-300 group-hover:text-[#D7FF3D]" />
            </div>
            <h3 className="font-serif text-2xl md:text-3xl font-light text-white/60 flex-1 transition-colors duration-300 group-hover:text-white">
              {feature.title}
            </h3>
          </div>

          <div className="grid grid-rows-[0fr] group-hover:grid-rows-[1fr] transition-[grid-template-rows] duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]">
            <div className="overflow-hidden">
              <div className="pl-[4.5rem] pb-9 opacity-0 group-hover:opacity-100 transition-opacity duration-300 delay-100">
                <p className="text-white/55 leading-relaxed font-light max-w-2xl mb-6">
                  {feature.description}
                </p>
                <div className="max-w-2xl">
                  {feature.points.map((point, j) => (
                    <div
                      key={point}
                      className="flex items-center gap-4 py-3 border-t border-white/10 first:border-t-0"
                    >
                      <span className="text-xs text-white/30 font-light w-6">
                        {String(j + 1).padStart(2, '0')}
                      </span>
                      <span className="text-white/85 font-medium">{point}</span>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => onSelect?.(feature)}
                  className="mt-6 text-sm font-medium text-white/70 hover:text-[#D7FF3D] transition-colors inline-flex items-center gap-1.5"
                >
                  Try it out →
                </button>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
