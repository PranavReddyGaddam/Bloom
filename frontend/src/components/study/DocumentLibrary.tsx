'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { DocumentInfo } from '@/types'
import { Check, ChevronDown, FileText, Library, Trash2, Loader2, Plus } from 'lucide-react'

const LIME = 'text-[#D7FF3D]'

// Documents library (ROADMAP 3.1): the memory layer stores every upload —
// this makes that store visible so material can be re-studied without
// re-uploading the file.
//
// Picking from here is the same action as attaching a file: the document
// becomes a chip in the study bar. That's what replaced the old "study these
// together" multi-select — attaching two library documents *is* studying them
// together, so a second selection mechanism for the same thing was redundant.
export function DocumentLibrary({
  attachedIds,
  onAdd,
  onRemove,
}: {
  // Document ids currently attached in the study bar, so rows can show their
  // state rather than duplicating the chips.
  attachedIds: string[]
  onAdd: (documentId: string) => Promise<void>
  onRemove: (documentId: string) => void
}) {
  const [documents, setDocuments] = useState<DocumentInfo[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const docs = await api.getMyDocuments()
        if (!cancelled) setDocuments(docs)
      } catch {
        // The library is an extra — a fetch failure just hides the section.
      } finally {
        if (!cancelled) setLoaded(true)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const handleAdd = useCallback(async (documentId: string) => {
    setBusyId(documentId)
    setError('')
    try {
      await onAdd(documentId)
    } catch {
      setError('Failed to add that document')
    } finally {
      setBusyId(null)
    }
  }, [onAdd])

  const handleDelete = useCallback(async (documentId: string) => {
    setBusyId(documentId)
    setError('')
    try {
      await api.deleteDocument(documentId)
      setDocuments(prev => prev.filter(d => d.id !== documentId))
      // A deleted document can't stay attached — its text is gone server-side.
      onRemove(documentId)
    } catch {
      setError('Failed to delete that document')
    } finally {
      setBusyId(null)
    }
  }, [onRemove])

  if (!loaded || documents.length === 0) return null

  const attachedCount = documents.filter(d => attachedIds.includes(d.id)).length

  return (
    <div className="mt-10">
      {/* Collapsed by default: the library grows with every upload, and a long
          list pushed the study bar off screen on the entry page. Full width so
          it still reads as a section rather than a small control. */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className={`w-full flex items-center gap-3 px-5 py-4 border border-white/15 bg-white/[0.04] backdrop-blur-xl hover:border-white/30 transition-colors ${
          open ? 'rounded-t-2xl border-b-0' : 'rounded-2xl'
        }`}
      >
        <Library className={`h-5 w-5 shrink-0 ${LIME}`} />
        <span className="flex-1 min-w-0 text-left">
          <span className="block text-white font-sans">Your library</span>
          <span className="block text-sm text-white/50 truncate">
            {documents.length} document{documents.length === 1 ? '' : 's'}
            {attachedCount > 0 && ` · ${attachedCount} added`}
            {' — '}add any of it without re-uploading
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-white/40 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {/* An error from Add/Delete lives inside this panel, so a collapsed
          library still surfaces it rather than swallowing the failure. */}
      {!open && error && (
        <p className="text-sm text-red-300 mt-2">{error}</p>
      )}

      {open && (
      <div className="rounded-b-2xl border border-white/15 border-t-0 bg-white/[0.02] backdrop-blur-xl p-3">
      {error && <p className="text-sm text-red-300 mb-3 px-1">{error}</p>}

      <ul className="space-y-2">
        {documents.map(doc => {
          const attached = attachedIds.includes(doc.id)
          const busy = busyId === doc.id
          return (
            <li
              key={doc.id}
              className={`flex items-center gap-3 rounded-xl border backdrop-blur-xl p-4 transition-colors ${
                attached
                  ? 'border-[#D7FF3D]/40 bg-[#D7FF3D]/[0.06]'
                  : 'border-white/15 bg-white/[0.04]'
              }`}
            >
              <FileText className={`h-5 w-5 shrink-0 ${LIME}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white truncate">{doc.filename}</p>
                <p className="text-xs text-white/40">
                  uploaded {new Date(doc.created_at).toLocaleDateString()} · {doc.chunk_count} sections
                </p>
              </div>

              <Button
                size="sm"
                variant="outline"
                onClick={() => (attached ? onRemove(doc.id) : handleAdd(doc.id))}
                disabled={busy}
                className={`shrink-0 ${
                  attached
                    ? 'border-[#D7FF3D]/50 bg-[#D7FF3D]/10 text-[#D7FF3D] hover:bg-[#D7FF3D]/20 hover:text-[#D7FF3D]'
                    : 'border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white'
                }`}
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : attached ? (
                  <>
                    <Check className="h-4 w-4 mr-1.5" />
                    Added
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-1.5" />
                    Add
                  </>
                )}
              </Button>

              <button
                type="button"
                onClick={() => handleDelete(doc.id)}
                disabled={busy}
                aria-label={`Delete ${doc.filename}`}
                className="shrink-0 text-white/40 hover:text-red-300 transition-colors disabled:opacity-40"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          )
        })}
      </ul>
      </div>
      )}
    </div>
  )
}
