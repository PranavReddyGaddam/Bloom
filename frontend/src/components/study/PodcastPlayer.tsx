'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Play, Pause, RotateCcw, RotateCw, Headphones, FileText, AlertTriangle,
} from 'lucide-react'
import { PodcastResponse, PodcastSegment } from '@/types'

const SKIP_SECONDS = 15

const SPEAKER_LABEL: Record<PodcastSegment['speaker'], string> = {
  host: 'Host',
  explainer: 'Explainer',
}

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

// Header duration is a rough "how long is this" signal, so minutes are enough —
// a student deciding whether to press play doesn't need the seconds.
function formatEpisodeLength(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60))
  return `${minutes} min`
}

function countWords(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  // A blank or punctuation-only turn would otherwise get a zero-width window and
  // could never become the active segment.
  return words || 1
}

export function PodcastPlayer({ podcast }: { podcast: PodcastResponse }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const transcriptRef = useRef<HTMLDivElement | null>(null)
  const turnRefs = useRef<(HTMLButtonElement | null)[]>([])

  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  // Prefer the real metadata duration over the backend's value once it loads —
  // the stored number comes from the TTS job and can be slightly off.
  const [duration, setDuration] = useState(podcast.duration_seconds ?? 0)
  const [scrubbing, setScrubbing] = useState(false)
  const [playbackFailed, setPlaybackFailed] = useState(false)
  // Auto-scroll is a convenience, not a hijack: once the student scrolls the
  // transcript themselves we stop moving it under them until they seek again.
  const [followActive, setFollowActive] = useState(true)

  const segments = podcast.segments ?? []

  // Segment boundaries, exact when the backend measured them.
  //
  // Each turn is synthesized as its own request, so the server knows every
  // turn's real playback offset in samples and sends it as `start_seconds`.
  // When those are present these are true timestamps: highlighting and
  // click-to-seek land exactly on the turn.
  //
  // The word-count fallback below only runs for episodes stored before
  // offsets existed, or where synthesis never happened. It splits the
  // duration by each turn's share of the total word count — close enough to
  // highlight the right turn, but it drifts on heavy punctuation or long
  // numerals, so it is a degradation, not the design.
  const boundaries = useMemo(() => {
    const exact = segments.every(s => typeof s.start_seconds === 'number')

    if (exact && duration) {
      return segments.map((segment, index) => ({
        start: segment.start_seconds as number,
        // A turn runs until the next one starts; the last runs to the end.
        end: (segments[index + 1]?.start_seconds as number | undefined) ?? duration,
      }))
    }

    const counts = segments.map(s => countWords(s.text))
    const totalWords = counts.reduce((a, b) => a + b, 0) || 1
    let elapsed = 0
    return counts.map(count => {
      const start = elapsed
      elapsed += (count / totalWords) * (duration || 0)
      return { start, end: elapsed }
    })
  }, [segments, duration])

  const activeIndex = useMemo(() => {
    if (!duration || boundaries.length === 0) return -1
    const found = boundaries.findIndex(b => currentTime >= b.start && currentTime < b.end)
    // Past the last boundary (rounding, or the tail of the file) the final turn
    // is still the one being spoken.
    if (found === -1 && currentTime > 0) return boundaries.length - 1
    return found
  }, [boundaries, currentTime, duration])

  // Audio is unusable if the backend never produced a file, or if the browser
  // failed on it at runtime. Both collapse to the same transcript-only state.
  const hasAudio = !!podcast.audio_url && !playbackFailed

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onTimeUpdate = () => {
      // While dragging the scrubber, the element's own timeupdate events would
      // fight the thumb — the drag handler owns currentTime until release.
      if (!scrubbing) setCurrentTime(audio.currentTime)
    }
    const onLoadedMetadata = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration)
    }
    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    const onEnded = () => {
      setIsPlaying(false)
      setCurrentTime(audio.duration || 0)
    }

    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('loadedmetadata', onLoadedMetadata)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnded)

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('loadedmetadata', onLoadedMetadata)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onEnded)
    }
  }, [scrubbing, hasAudio])

  useEffect(() => {
    if (!followActive || !isPlaying || activeIndex < 0) return
    // 'nearest' on the turn keeps the scroll inside the transcript container —
    // 'center'/'start' would drag the whole lesson page around it.
    turnRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeIndex, followActive, isPlaying])

  const togglePlay = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      // Autoplay policy or a decode failure both surface as a rejected promise
      // rather than an error event, so the fallback has to be wired here too.
      audio.play().catch(() => setPlaybackFailed(true))
    } else {
      audio.pause()
    }
  }, [])

  const seekTo = useCallback((seconds: number) => {
    const audio = audioRef.current
    if (!audio) return
    const clamped = Math.min(Math.max(seconds, 0), duration || audio.duration || 0)
    audio.currentTime = clamped
    setCurrentTime(clamped)
    // Any deliberate seek is the student re-engaging, so resume following.
    setFollowActive(true)
  }, [duration])

  const skip = useCallback((delta: number) => {
    const audio = audioRef.current
    if (!audio) return
    seekTo(audio.currentTime + delta)
  }, [seekTo])

  const handleTurnClick = useCallback((index: number) => {
    if (!hasAudio) return
    seekTo(boundaries[index]?.start ?? 0)
  }, [boundaries, hasAudio, seekTo])

  const headerLength = duration > 0
    ? formatEpisodeLength(duration)
    : podcast.duration_seconds
      ? formatEpisodeLength(podcast.duration_seconds)
      : null

  return (
    <div className="bg-white/[0.06] backdrop-blur-xl rounded-2xl border border-white/15 p-6">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-start gap-3 min-w-0">
          <div className="h-9 w-9 shrink-0 rounded-full bg-[#D7FF3D]/10 border border-[#D7FF3D]/30 flex items-center justify-center">
            <Headphones className="h-4 w-4 text-[#D7FF3D]" />
          </div>
          <div className="min-w-0">
            <h3 className="text-xl font-bold text-white font-sans leading-snug truncate">
              {podcast.title}
            </h3>
            <p className="text-sm text-white/60 mt-0.5">
              {podcast.subject}
              {headerLength && <> • {headerLength}</>}
              {segments.length > 0 && <> • {segments.length} turns</>}
            </p>
          </div>
        </div>
      </div>

      {hasAudio ? (
        <div className="mb-6 rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <audio
            ref={audioRef}
            src={podcast.audio_url ?? undefined}
            preload="metadata"
            onError={() => setPlaybackFailed(true)}
            className="hidden"
          />

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="icon"
              onClick={() => skip(-SKIP_SECONDS)}
              aria-label={`Back ${SKIP_SECONDS} seconds`}
              className="border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white rounded-full shrink-0"
            >
              <RotateCcw className="h-4 w-4" />
            </Button>

            <Button
              size="icon"
              onClick={togglePlay}
              aria-label={isPlaying ? 'Pause episode' : 'Play episode'}
              className="bg-[#D7FF3D] text-black hover:bg-[#c2e836] rounded-full h-11 w-11 shrink-0"
            >
              {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
            </Button>

            <Button
              variant="outline"
              size="icon"
              onClick={() => skip(SKIP_SECONDS)}
              aria-label={`Forward ${SKIP_SECONDS} seconds`}
              className="border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white rounded-full shrink-0"
            >
              <RotateCw className="h-4 w-4" />
            </Button>

            <span className="text-xs text-white/60 tabular-nums shrink-0 ml-1">
              {formatClock(currentTime)}
            </span>

            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={Math.min(currentTime, duration || 0)}
              onChange={(e) => setCurrentTime(Number(e.target.value))}
              onPointerDown={() => setScrubbing(true)}
              onPointerUp={(e) => {
                setScrubbing(false)
                seekTo(Number((e.target as HTMLInputElement).value))
              }}
              // Keyboard arrows fire change without any pointer event, so commit
              // the seek here as well or the range would move but the audio wouldn't.
              onKeyUp={(e) => seekTo(Number((e.target as HTMLInputElement).value))}
              aria-label="Seek through episode"
              aria-valuetext={`${formatClock(currentTime)} of ${formatClock(duration)}`}
              disabled={!duration}
              className="flex-1 h-1 min-w-0 appearance-none rounded-full bg-white/15 accent-[#D7FF3D] cursor-pointer disabled:opacity-40 disabled:cursor-default"
            />

            <span className="text-xs text-white/40 tabular-nums shrink-0">
              {formatClock(duration)}
            </span>
          </div>
        </div>
      ) : (
        <div className="mb-6 rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-white/40" />
            <div>
              <p className="text-sm text-white/70 font-sans">
                {playbackFailed
                  ? 'The audio for this episode failed to play.'
                  : podcast.audio_error || 'Audio for this episode could not be generated.'}
              </p>
              <p className="text-xs text-white/40 mt-1">
                The full script is below — it covers the same material.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 text-sm text-white/60 mb-3">
        <FileText className="h-4 w-4" />
        <span>{hasAudio ? 'Transcript — tap a line to jump there' : 'Episode script'}</span>
      </div>

      <div
        ref={transcriptRef}
        // Manual scrolling suspends auto-follow; a seek or a new play turns it
        // back on. Without this the highlight yanks the pane away from anyone
        // reading ahead or re-reading an earlier turn.
        onWheel={() => setFollowActive(false)}
        onTouchMove={() => setFollowActive(false)}
        className={`space-y-4 pr-1 ${hasAudio ? 'max-h-[26rem] overflow-y-auto' : ''}`}
      >
        {segments.map((segment, index) => {
          const isHost = segment.speaker === 'host'
          const isActive = hasAudio && index === activeIndex

          return (
            <button
              key={index}
              ref={(el) => { turnRefs.current[index] = el }}
              type="button"
              onClick={() => handleTurnClick(index)}
              disabled={!hasAudio}
              aria-current={isActive ? 'true' : undefined}
              className={`w-full text-left flex items-start gap-3 ${
                isHost ? '' : 'flex-row-reverse'
              } ${hasAudio ? 'cursor-pointer' : 'cursor-default'}`}
            >
              <div className={`flex-1 min-w-0 ${isHost ? '' : 'flex flex-col items-end'}`}>
                <p className="text-xs text-white/40 mb-1.5 px-1">
                  {SPEAKER_LABEL[segment.speaker]}
                </p>
                <div
                  className={`rounded-2xl border p-4 transition-colors ${
                    isHost ? 'rounded-tl-sm' : 'rounded-tr-sm'
                  } ${
                    isActive
                      ? 'border-[#D7FF3D]/60 bg-[#D7FF3D]/[0.12]'
                      : isHost
                        ? 'border-white/15 bg-white/[0.05] hover:bg-white/[0.08]'
                        : 'border-[#D7FF3D]/30 bg-[#D7FF3D]/[0.06] hover:bg-[#D7FF3D]/[0.1]'
                  }`}
                >
                  <p className={`leading-relaxed font-sans ${isActive ? 'text-white' : 'text-white/70'}`}>
                    {segment.text}
                  </p>
                </div>
              </div>
            </button>
          )
        })}

        {segments.length === 0 && (
          <p className="text-sm text-white/50">This episode has no transcript.</p>
        )}
      </div>
    </div>
  )
}
