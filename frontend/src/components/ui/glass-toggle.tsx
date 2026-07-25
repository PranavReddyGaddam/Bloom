'use client'

import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface GlassToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
  // Labels the control for AT when the visible label lives in a wrapping
  // element rather than a <label> tied to this input.
  ariaLabel?: string
}

// Checkbox counterpart to GlassRadio, for the same reason: the browser paints
// native checkboxes as an opaque box that `accent-color` won't make
// translucent, which reads as a solid blob on the glass cards. Keeps a real
// <input type="checkbox"> for keyboard/AT support but hides it visually
// (sr-only, not display:none — the latter drops it from the tab order) and
// draws the control with peer-driven styles instead.
export function GlassToggle({
  checked, onChange, disabled = false, className, ariaLabel,
}: GlassToggleProps) {
  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        aria-label={ariaLabel}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={cn(
          'h-4 w-4 rounded-[5px] border border-white/30 bg-white/[0.06] backdrop-blur-sm',
          'transition-colors peer-hover:border-white/50',
          'peer-focus-visible:ring-2 peer-focus-visible:ring-[#D7FF3D]/60 peer-focus-visible:ring-offset-0',
          'peer-disabled:opacity-40',
          'peer-checked:border-[#D7FF3D]/80 peer-checked:bg-[#D7FF3D]/20',
          'flex items-center justify-center',
        )}
      >
        <Check
          className={cn(
            'h-3 w-3 text-[#D7FF3D] transition-transform',
            checked ? 'scale-100' : 'scale-0',
          )}
          strokeWidth={3}
        />
      </span>
    </span>
  )
}
