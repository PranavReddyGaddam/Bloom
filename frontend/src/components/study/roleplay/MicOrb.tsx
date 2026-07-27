'use client'

import { Mic, MicOff } from 'lucide-react'

interface Props {
  // RMS level of the current 80ms frame, 0-1. Drives the ring only.
  level: number
  active: boolean
  muted?: boolean
  pushToTalk?: boolean
  onPointerDown?: () => void
  onPointerUp?: () => void
  onClick?: () => void
  disabled?: boolean
}

/**
 * The mic button and its level ring.
 *
 * The ring reflects input level only — it is not a turn indicator. Flux
 * decides when a turn ends, server-side, so there is nothing here that
 * approximates endpointing and nothing the student should read as "it's
 * listening for a pause".
 */
export function MicOrb({
  level,
  active,
  muted = false,
  pushToTalk = false,
  onPointerDown,
  onPointerUp,
  onClick,
  disabled = false,
}: Props) {
  // Compress the RMS into something visible: speech mostly sits low in the
  // range, so a linear map barely moves.
  const scale = 1 + Math.min(level * 3, 1) * 0.35

  const handlers = pushToTalk
    ? {
        onPointerDown,
        onPointerUp,
        onPointerLeave: onPointerUp,
      }
    : { onClick }

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        type="button"
        disabled={disabled}
        {...handlers}
        aria-label={
          pushToTalk ? 'Hold to talk' : active ? 'Mute microphone' : 'Unmute microphone'
        }
        className={`relative h-16 w-16 rounded-full flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
          active && !muted
            ? 'bg-[#D7FF3D] text-black'
            : 'bg-white/[0.08] border border-white/20 text-white/70'
        }`}
      >
        {active && !muted && (
          <span
            aria-hidden
            className="absolute inset-0 rounded-full bg-[#D7FF3D]/25 transition-transform duration-75"
            style={{ transform: `scale(${scale})` }}
          />
        )}
        <span className="relative">
          {muted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
        </span>
      </button>

      <span className="text-xs text-white/40">
        {muted
          ? 'Muted while they speak'
          : pushToTalk
            ? 'Hold to talk'
            : active
              ? 'Listening'
              : 'Tap to talk'}
      </span>
    </div>
  )
}
