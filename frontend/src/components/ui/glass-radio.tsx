'use client'

import { cn } from '@/lib/utils'

interface GlassRadioProps {
  name: string
  value: string
  checked: boolean
  onChange: () => void
  disabled?: boolean
  className?: string
  // Renders the selected state in the feedback palette rather than lime:
  // the graded-correct / graded-wrong colours the answer views use.
  tone?: 'default' | 'correct' | 'wrong'
}

// The browser paints native radios as an opaque disc that no amount of
// `accent-color` will make translucent, which reads as a solid white blob on
// the glass cards. This keeps a real <input> for keyboard/AT support but
// hides it visually (sr-only, not display:none — the latter drops it from the
// tab order) and draws the control with peer-driven styles instead.
export function GlassRadio({
  name, value, checked, onChange, disabled = false, className, tone = 'default',
}: GlassRadioProps) {
  const ring = {
    default: 'peer-checked:border-[#D7FF3D]/80 peer-checked:bg-[#D7FF3D]/20',
    correct: 'peer-checked:border-[#D7FF3D]/80 peer-checked:bg-[#D7FF3D]/20',
    wrong: 'peer-checked:border-red-400/80 peer-checked:bg-red-400/20',
  }[tone]

  const dot = {
    default: 'bg-[#D7FF3D]',
    correct: 'bg-[#D7FF3D]',
    wrong: 'bg-red-300',
  }[tone]

  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={cn(
          'h-4 w-4 rounded-full border border-white/30 bg-white/[0.06] backdrop-blur-sm',
          'transition-colors peer-hover:border-white/50',
          'peer-focus-visible:ring-2 peer-focus-visible:ring-[#D7FF3D]/60 peer-focus-visible:ring-offset-0',
          'flex items-center justify-center',
          ring,
        )}
      >
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full transition-transform',
            checked ? 'scale-100' : 'scale-0',
            dot,
          )}
        />
      </span>
    </span>
  )
}
