'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { DocumentInfo } from '@/types'
import { Check, FileText, Trash2, Loader2, Plus } from 'lucide-react'

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

  return (
    <div className="mt-10">
      <h2 className="text-lg font-medium text-white mb-1 font-sans">Your library</h2>
      <p className="text-sm text-white/50 mb-4">
        Everything you&apos;ve uploaded before — add any of it to what you&apos;re studying,
        without re-uploading the file
      </p>

      {error && <p className="text-sm text-red-300 mb-3">{error}</p>}

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
  )
}
