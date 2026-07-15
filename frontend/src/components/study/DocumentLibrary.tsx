'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { DocumentInfo } from '@/types'
import { FileText, Trash2, Loader2 } from 'lucide-react'

const LIME = 'text-[#D7FF3D]'

// Documents library (ROADMAP 3.1): the memory layer stores every upload —
// this makes that store visible so material can be re-studied without
// re-uploading the file.
export function DocumentLibrary({ onOpen }: { onOpen: (documentId: string) => Promise<void> }) {
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

  const handleOpen = useCallback(async (documentId: string) => {
    setBusyId(documentId)
    setError('')
    try {
      await onOpen(documentId)
    } catch {
      setError('Failed to open that document')
    } finally {
      setBusyId(null)
    }
  }, [onOpen])

  const handleDelete = useCallback(async (documentId: string) => {
    setBusyId(documentId)
    setError('')
    try {
      await api.deleteDocument(documentId)
      setDocuments(prev => prev.filter(d => d.id !== documentId))
    } catch {
      setError('Failed to delete that document')
    } finally {
      setBusyId(null)
    }
  }, [])

  if (!loaded || documents.length === 0) return null

  return (
    <div className="mt-10">
      <h2 className="text-lg font-medium text-white mb-1 font-sans">Your library</h2>
      <p className="text-sm text-white/50 mb-4">
        Everything you&apos;ve uploaded before — study it again without re-uploading
      </p>

      {error && <p className="text-sm text-red-300 mb-3">{error}</p>}

      <ul className="space-y-2">
        {documents.map(doc => (
          <li
            key={doc.id}
            className="flex items-center gap-3 rounded-xl border border-white/15 bg-white/[0.04] backdrop-blur-xl p-4"
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
              onClick={() => handleOpen(doc.id)}
              disabled={busyId !== null}
              className="border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white shrink-0"
            >
              {busyId === doc.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Study this again'}
            </Button>
            <button
              type="button"
              onClick={() => handleDelete(doc.id)}
              disabled={busyId !== null}
              aria-label={`Delete ${doc.filename}`}
              className="shrink-0 text-white/40 hover:text-red-300 transition-colors disabled:opacity-40"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
