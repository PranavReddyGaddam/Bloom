'use client'

import { useRef, useState } from 'react'
import {
  ArrowUp, BookOpen, ChevronDown, ClipboardList, FileText, GraduationCap, Link as LinkIcon,
  Loader2, Paperclip, PencilLine, Sliders, Target, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { GlassToggle } from '@/components/ui/glass-toggle'
import { SubjectSelect } from './SubjectSelect'
import {
  StudyFormData, StudyOutput, StudyPreset, PRESETS, SummaryType, Difficulty, Subject, TutorMode,
} from '@/types'

const LIME = 'text-[#D7FF3D]'
const LIME_BG = 'bg-[#D7FF3D]'

// One piece of study material in the bar. `documentId` is the library row it
// came from — set for both paths, since an upload is stored on arrival.
export interface Attachment {
  documentId: string
  filename: string
  textContent: string
}

const OUTPUTS: { value: StudyOutput; icon: React.ReactNode; label: string }[] = [
  { value: 'pretest', icon: <Target className="h-4 w-4" />, label: 'Pretest' },
  { value: 'summary', icon: <ClipboardList className="h-4 w-4" />, label: 'Summary' },
  { value: 'flashcards', icon: <BookOpen className="h-4 w-4" />, label: 'Flashcards' },
  { value: 'quiz', icon: <PencilLine className="h-4 w-4" />, label: 'Quiz' },
  { value: 'tutor', icon: <GraduationCap className="h-4 w-4" />, label: 'Tutor' },
]

const PRESET_ORDER = ['quick_review', 'exam_prep', 'deep_dive', 'test_first'] as const

// Which preset (if any) exactly matches a selection, so toggling back to a
// known combination re-highlights that preset instead of staying on "custom".
function matchPreset(outputs: StudyOutput[]): StudyPreset {
  const key = [...outputs].sort().join(',')
  for (const name of PRESET_ORDER) {
    if ([...PRESETS[name].outputs].sort().join(',') === key) return name
  }
  return 'custom'
}

interface StudyBarProps {
  formData: StudyFormData
  setFormData: React.Dispatch<React.SetStateAction<StudyFormData>>
  attachments: Attachment[]
  onAttachFile: (file: File) => Promise<void>
  onAttachUrl: (url: string) => Promise<void>
  onRemoveAttachment: (documentId: string) => void
  onStart: () => void
  loading: boolean
  progressStage?: string
  error?: string
}

// The app's front door: attach material, say what you want, pick what to make,
// go. Everything needed to start is on this one surface — splitting upload from
// intent across two screens only delayed the first useful result.
//
// Material is a hard gate: with nothing attached there is nothing to generate
// from, so the CTA stays disabled rather than failing later with an error.
export function StudyBar({
  formData,
  setFormData,
  attachments,
  onAttachFile,
  onAttachUrl,
  onRemoveAttachment,
  onStart,
  loading,
  progressStage,
  error,
}: StudyBarProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [attaching, setAttaching] = useState(false)
  const [attachError, setAttachError] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [urlOpen, setUrlOpen] = useState(false)
  const [urlValue, setUrlValue] = useState('')

  const selected = (output: StudyOutput) => formData.outputs.includes(output)

  const attachFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setAttaching(true)
    setAttachError('')
    try {
      // Sequential rather than parallel: extraction is heavy server-side and
      // each upload reports its own progress, so a queue reads more honestly
      // than several bars moving at once.
      for (const file of Array.from(files)) {
        await onAttachFile(file)
      }
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : 'Failed to add that file')
    } finally {
      setAttaching(false)
    }
  }

  // A link takes the same route as a file: ingest, then it's an attachment.
  // Video transcription can run for minutes, so this leans on the same
  // progress reporting the upload path uses rather than a bare spinner.
  const submitUrl = async () => {
    const url = urlValue.trim()
    if (!url) return
    setAttaching(true)
    setAttachError('')
    try {
      await onAttachUrl(url)
      setUrlValue('')
      setUrlOpen(false)
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : 'Failed to add that link')
    } finally {
      setAttaching(false)
    }
  }

  const handleFileInput = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    // Reset immediately so picking the same file twice still fires onChange.
    event.target.value = ''
    await attachFiles(files)
  }

  const applyPreset = (preset: Exclude<StudyPreset, 'custom'>) => {
    setFormData(prev => ({ ...prev, preset, outputs: [...PRESETS[preset].outputs] }))
  }

  const toggleOutput = (output: StudyOutput) => {
    setFormData(prev => {
      const outputs = prev.outputs.includes(output)
        ? prev.outputs.filter(o => o !== output)
        : [...prev.outputs, output]
      return { ...prev, outputs, preset: matchPreset(outputs) }
    })
  }

  // The tutor and pretest both need a named subject server-side; the artifact
  // generators tolerate an empty one.
  const needsSubject = selected('tutor') || selected('pretest')
  const blocker =
    attachments.length === 0 ? 'Attach something to study first'
      : formData.outputs.length === 0 ? 'Pick at least one thing to make'
      : needsSubject && !formData.subjectName ? 'Pick a subject — the pretest and tutor need one'
      : null

  const ctaLabel = selected('pretest')
    ? 'Start pretest'
    : formData.outputs.length === 1 && selected('tutor')
      ? 'Start tutor session'
      : 'Start studying'

  return (
    <div>
      {/* The bar itself */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={async (e) => {
          e.preventDefault()
          setDragging(false)
          if (!loading && !attaching) await attachFiles(e.dataTransfer.files)
        }}
        className={`rounded-2xl border backdrop-blur-xl transition-colors ${
          dragging
            ? 'border-[#D7FF3D]/60 bg-[#D7FF3D]/[0.08]'
            : 'border-white/15 bg-white/[0.06] focus-within:border-[#D7FF3D]/40'
        }`}
      >
        {/* Attached material */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 p-3 pb-0">
            {attachments.map(item => (
              <span
                key={item.documentId}
                className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/[0.06] pl-2.5 pr-1.5 py-1.5"
              >
                <FileText className={`h-3.5 w-3.5 shrink-0 ${LIME}`} />
                <span className="text-sm text-white/80 truncate max-w-[14rem]">{item.filename}</span>
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(item.documentId)}
                  disabled={loading}
                  aria-label={`Remove ${item.filename}`}
                  className="text-white/40 hover:text-white transition-colors disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}

        {urlOpen && (
          <div className="flex items-center gap-2 px-3 pt-3">
            <input
              type="url"
              value={urlValue}
              onChange={(e) => setUrlValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); submitUrl() }
                if (e.key === 'Escape') { setUrlOpen(false); setUrlValue('') }
              }}
              disabled={loading || attaching}
              autoFocus
              placeholder="Paste a YouTube video or article link…"
              className="flex-1 rounded-lg border border-white/15 bg-white/[0.06] px-3 py-2 text-sm text-white placeholder:text-white/35 outline-none focus:border-[#D7FF3D]/40 disabled:opacity-50"
            />
            <Button
              onClick={submitUrl}
              disabled={loading || attaching || !urlValue.trim()}
              className={`${LIME_BG} text-black hover:bg-[#c2e836] shrink-0`}
            >
              {attaching ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add'}
            </Button>
          </div>
        )}

        <textarea
          value={formData.focusNote}
          onChange={(e) => setFormData(prev => ({ ...prev, focusNote: e.target.value }))}
          disabled={loading}
          rows={2}
          placeholder={
            attachments.length === 0
              ? 'Drop your notes, slides or readings here to get started…'
              : 'Anything specific you want to focus on? (optional)'
          }
          className="w-full resize-none bg-transparent text-white placeholder:text-white/35 text-[15px] leading-relaxed px-4 pt-4 pb-2 outline-none disabled:opacity-50"
        />

        {/* Bar actions */}
        <div className="flex items-center justify-between gap-3 px-3 pb-3">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={loading || attaching}
              aria-label="Attach study material"
              title="Attach a file"
              className="p-2 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50"
            >
              {attaching
                ? <Loader2 className="h-[18px] w-[18px] animate-spin" />
                : <Paperclip className="h-[18px] w-[18px]" />}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.docx,.pptx"
              multiple
              onChange={handleFileInput}
              className="hidden"
              disabled={loading || attaching}
            />

            <button
              type="button"
              onClick={() => setUrlOpen(o => !o)}
              disabled={loading || attaching}
              aria-expanded={urlOpen}
              aria-label="Add a link"
              title="Add a YouTube video or article link"
              className={`p-2 rounded-lg transition-colors disabled:opacity-50 ${
                urlOpen ? 'text-white bg-white/10' : 'text-white/50 hover:text-white hover:bg-white/10'
              }`}
            >
              <LinkIcon className="h-[18px] w-[18px]" />
            </button>

            <button
              type="button"
              onClick={() => setAdvancedOpen(o => !o)}
              disabled={loading}
              aria-expanded={advancedOpen}
              className={`inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-sm transition-colors disabled:opacity-50 ${
                advancedOpen ? 'text-white bg-white/10' : 'text-white/50 hover:text-white hover:bg-white/10'
              }`}
            >
              <Sliders className="h-4 w-4" />
              Advanced
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
            </button>
          </div>

          <Button
            onClick={onStart}
            disabled={loading || attaching || !!blocker}
            title={blocker ?? undefined}
            className={`${LIME_BG} text-black hover:bg-[#c2e836] shrink-0`}
          >
            {loading ? (
              <>
                <div className="animate-spin h-4 w-4 mr-2 border-2 border-black/60 border-t-transparent rounded-full" />
                {progressStage || 'Working…'}
              </>
            ) : (
              <>
                {ctaLabel}
                <ArrowUp className="h-4 w-4 ml-1.5" />
              </>
            )}
          </Button>
        </div>
      </div>

      {(error || attachError) && (
        <p className="text-sm text-red-300 mt-2">{error || attachError}</p>
      )}
      {!error && !attachError && blocker && !loading && (
        <p className="text-sm text-white/40 mt-2">{blocker}</p>
      )}

      {/* Presets */}
      <div className="flex flex-wrap gap-2 mt-4">
        {PRESET_ORDER.map(name => {
          const active = formData.preset === name
          return (
            <button
              key={name}
              type="button"
              onClick={() => applyPreset(name)}
              disabled={loading}
              title={PRESETS[name].description}
              className={`text-sm rounded-full px-3.5 py-1.5 border transition-colors disabled:opacity-50 ${
                active
                  ? 'border-[#D7FF3D]/60 bg-[#D7FF3D]/15 text-[#D7FF3D]'
                  : 'border-white/15 text-white/60 hover:text-white hover:border-white/30'
              }`}
            >
              {PRESETS[name].label}
            </button>
          )
        })}
      </div>

      {/* Output toggles */}
      <div className="flex flex-wrap gap-2 mt-3">
        {OUTPUTS.map(output => {
          const active = selected(output.value)
          return (
            <label
              key={output.value}
              className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 cursor-pointer transition-colors ${
                active
                  ? 'border-[#D7FF3D]/40 bg-[#D7FF3D]/[0.08]'
                  : 'border-white/10 hover:border-white/25'
              } ${loading ? 'opacity-50 pointer-events-none' : ''}`}
            >
              <GlassToggle
                checked={active}
                onChange={() => toggleOutput(output.value)}
                disabled={loading}
              />
              <span className={active ? LIME : 'text-white/40'}>{output.icon}</span>
              <span className={`text-sm ${active ? 'text-white' : 'text-white/60'}`}>
                {output.label}
              </span>
            </label>
          )
        })}
      </div>

      {/* Advanced settings */}
      {advancedOpen && (
        <div className="mt-4 rounded-2xl border border-white/15 bg-white/[0.04] backdrop-blur-xl p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <SubjectSelect
              labelHtmlFor="subject"
              subjectId={formData.subjectId}
              onSelect={(subject: Subject) =>
                setFormData(prev => ({ ...prev, subjectId: subject.id, subjectName: subject.name }))
              }
            />

            {(selected('summary') || selected('pretest')) && (
              <div className="space-y-2">
                <Label className="text-sm font-medium text-white/70">Summary Format</Label>
                <Select
                  value={formData.summaryType}
                  onValueChange={(value: SummaryType) =>
                    setFormData(prev => ({ ...prev, summaryType: value }))
                  }
                >
                  <SelectTrigger className="bg-white/5 border-white/20 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#0d1230] border-white/15 text-white">
                    <SelectItem value="short">Short (2-3 paragraphs)</SelectItem>
                    <SelectItem value="bullet_points">Bullet Points</SelectItem>
                    <SelectItem value="detailed">Detailed Summary</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {selected('flashcards') && (
              <>
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-white/70">Card Type</Label>
                  <Select
                    value={formData.cardType}
                    onValueChange={(value: StudyFormData['cardType']) =>
                      setFormData(prev => ({ ...prev, cardType: value }))
                    }
                  >
                    <SelectTrigger className="bg-white/5 border-white/20 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#0d1230] border-white/15 text-white">
                      <SelectItem value="definition">Definitions</SelectItem>
                      <SelectItem value="concept">Concepts</SelectItem>
                      <SelectItem value="fact">Facts</SelectItem>
                      <SelectItem value="mixed">Mixed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium text-white/70">Number of Cards</Label>
                  <Select
                    value={formData.numCards.toString()}
                    onValueChange={(value) =>
                      setFormData(prev => ({ ...prev, numCards: parseInt(value) }))
                    }
                  >
                    <SelectTrigger className="bg-white/5 border-white/20 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#0d1230] border-white/15 text-white">
                      {[5, 10, 15, 20, 25, 30].map(num => (
                        <SelectItem key={num} value={num.toString()}>{num} cards</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            {selected('quiz') && (
              <>
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-white/70">Number of Questions</Label>
                  <Select
                    value={formData.numQuestions.toString()}
                    onValueChange={(value) =>
                      setFormData(prev => ({ ...prev, numQuestions: parseInt(value) }))
                    }
                  >
                    <SelectTrigger className="bg-white/5 border-white/20 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#0d1230] border-white/15 text-white">
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20].map(num => (
                        <SelectItem key={num} value={num.toString()}>{num} questions</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium text-white/70">Difficulty Level</Label>
                  <Select
                    value={formData.difficulty}
                    onValueChange={(value: Difficulty) =>
                      setFormData(prev => ({ ...prev, difficulty: value }))
                    }
                  >
                    <SelectTrigger className="bg-white/5 border-white/20 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#0d1230] border-white/15 text-white">
                      <SelectItem value="easy">Easy (Basic concepts)</SelectItem>
                      <SelectItem value="medium">Medium (Mixed)</SelectItem>
                      <SelectItem value="hard">Hard (Critical thinking)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            {selected('tutor') && (
              <div className="space-y-2">
                <Label className="text-sm font-medium text-white/70">Tutor Mode</Label>
                <Select
                  value={formData.tutorMode}
                  onValueChange={(value) =>
                    setFormData(prev => ({ ...prev, tutorMode: value as TutorMode }))
                  }
                >
                  <SelectTrigger className="bg-white/5 border-white/20 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#0d1230] border-white/15 text-white">
                    <SelectItem value="vibe_check">Vibe check — a quick pass over the core ideas</SelectItem>
                    <SelectItem value="locked_in">Locked in — drilled until it actually sticks</SelectItem>
                    <SelectItem value="teach_back">Teach it back — you correct the tutor&apos;s mistakes</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {selected('tutor') && (
            <p className="text-sm text-white/50 mt-6">
              {formData.tutorMode === 'teach_back' ? (
                <>
                  The roles flip: the tutor plays a confused student and says something wrong —
                  sometimes a mistake you&apos;ve actually made before — and you set it straight in your
                  own words. Say what&apos;s wrong <em>and</em> what&apos;s right; explaining it is the point.
                </>
              ) : (
                <>
                  No question count, no difficulty to pick — the tutor keeps probing each concept in
                  new framings until it&apos;s convinced you&apos;ve actually learned it, then stops on its own.
                </>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
