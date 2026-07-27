'use client'

import { useSyncExternalStore } from 'react'
import { api, APIError } from '@/lib/api'
import type { PDFUploadResponse } from '@/types'

// Every in-flight source ingestion, held outside React.
//
// `BloomApp` is mounted by exactly one route (`app/(app)/upload/page.tsx`), and
// the sidebar router.pushes to /review and /scores unmount it — destroying
// component state and aborting any fetch it owned. A Provider one level up
// would still die on the escapes to `/`. So this is a plain module singleton:
// it survives every unmount within the SPA, and a hard refresh (which it does
// not survive) is an acceptable loss, since nothing was recorded server-side
// for the student to lose track of.
//
// Results are handed back through localStorage rather than a callback, because
// an ingest can resolve while no component is listening — see `onResolved`.

const STORED_FILE_KEY = 'bloom-attachments'

// How many ingests run at once. Extraction is heavy server-side and the backend
// has no per-user limit, so the store enforces one; waiting entries still get a
// chip immediately, showing "Queued".
const MAX_CONCURRENT = 3
const POLL_MS = 800

export type PendingStatus = 'queued' | 'running' | 'failed'

export interface PendingIngest {
  tempId: string
  kind: 'url' | 'file'
  // The URL or filename — stands in for the real title until one arrives.
  label: string
  stage: string | null
  status: PendingStatus
  error?: string
}

// Success is deliberately not a status. A resolved ingest is removed and its
// Attachment appended, so "what is attached" keeps one answer.
interface Job extends PendingIngest {
  progressId: string
  controller: AbortController
  run: (progressId: string, signal: AbortSignal) => Promise<PDFUploadResponse>
  timer: ReturnType<typeof setInterval> | null
}

export interface ResolvedIngest {
  documentId: string
  filename: string
  textContent: string
  similarDocuments: PDFUploadResponse['similar_documents']
  truncated?: boolean
}

const jobs = new Map<string, Job>()
const listeners = new Set<() => void>()
const resolvedListeners = new Set<(r: ResolvedIngest) => void>()

// useSyncExternalStore compares snapshots by identity and throws
// "The result of getSnapshot should be cached" if a fresh one comes back every
// call. So the array is rebuilt only on mutation.
let snapshot: PendingIngest[] = []

function publish() {
  snapshot = Array.from(jobs.values()).map(({ tempId, kind, label, stage, status, error }) => ({
    tempId, kind, label, stage, status, error,
  }))
  listeners.forEach(fn => fn())
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

function getSnapshot() {
  return snapshot
}

// The server is the only writer of ids; on the server there is never anything
// in flight, so a stable empty array keeps hydration quiet.
const EMPTY: PendingIngest[] = []
function getServerSnapshot() {
  return EMPTY
}

function stopPolling(job: Job) {
  if (job.timer !== null) {
    clearInterval(job.timer)
    job.timer = null
  }
}

// Append a resolved document id to the persisted list rather than rewriting it.
// The ingest may resolve while BloomApp is unmounted, so this is the only path
// that carries the attachment across the boundary — the restore effect
// re-hydrates it (and re-fetches the text) on remount.
function persistDocumentId(documentId: string) {
  try {
    const stored = localStorage.getItem(STORED_FILE_KEY)
    const ids: unknown = stored ? JSON.parse(stored) : []
    const list = Array.isArray(ids) ? (ids as string[]).filter(id => typeof id === 'string') : []
    if (list.includes(documentId)) return
    localStorage.setItem(STORED_FILE_KEY, JSON.stringify([...list, documentId]))
  } catch {
    localStorage.setItem(STORED_FILE_KEY, JSON.stringify([documentId]))
  }
}

// Start any queued jobs the limiter now has room for.
function pump() {
  const running = Array.from(jobs.values()).filter(j => j.status === 'running').length
  let slots = MAX_CONCURRENT - running
  if (slots <= 0) return

  for (const job of jobs.values()) {
    if (slots === 0) break
    if (job.status !== 'queued') continue
    slots -= 1
    execute(job)
  }
}

function execute(job: Job) {
  job.status = 'running'
  job.stage = null
  publish()

  job.timer = setInterval(async () => {
    try {
      const { stage } = await api.getProgress(job.progressId)
      // A late poll for a job that has already settled must not resurrect it.
      if (stage && jobs.get(job.tempId) === job && job.status === 'running') {
        job.stage = stage
        publish()
      }
    } catch {
      // Progress is cosmetic — the chip keeps its last stage.
    }
  }, POLL_MS)

  job.run(job.progressId, job.controller.signal).then(
    (result) => {
      stopPolling(job)
      // Cancelled while in flight: the entry is already gone, and the student
      // asked for it to be gone. Don't attach it behind their back.
      if (jobs.get(job.tempId) !== job) return

      if (!result.document_id) {
        job.status = 'failed'
        job.error = job.kind === 'url'
          ? 'That link was processed but could not be saved'
          : 'That file was processed but could not be saved'
        publish()
        pump()
        return
      }

      jobs.delete(job.tempId)
      persistDocumentId(result.document_id)
      publish()

      const resolved: ResolvedIngest = {
        documentId: result.document_id,
        filename: result.filename || job.label,
        textContent: result.text_content,
        similarDocuments: result.similar_documents ?? [],
        truncated: result.truncated,
      }
      resolvedListeners.forEach(fn => fn(resolved))
      pump()
    },
    (err) => {
      stopPolling(job)
      if (jobs.get(job.tempId) !== job) return
      // An abort is a cancellation, not a failure — the entry is already gone
      // in that path, so anything landing here is a real error.
      if (err instanceof DOMException && err.name === 'AbortError') {
        jobs.delete(job.tempId)
        publish()
        pump()
        return
      }
      job.status = 'failed'
      job.stage = null
      job.error = err instanceof APIError || err instanceof Error
        ? err.message
        : job.kind === 'url' ? 'Failed to add that link' : 'Failed to add that file'
      publish()
      pump()
    },
  )
}

function add(
  kind: 'url' | 'file',
  label: string,
  run: (progressId: string, signal: AbortSignal) => Promise<PDFUploadResponse>,
): string {
  const tempId = crypto.randomUUID()
  jobs.set(tempId, {
    tempId,
    kind,
    label,
    stage: null,
    status: 'queued',
    progressId: crypto.randomUUID(),
    controller: new AbortController(),
    run,
    timer: null,
  })
  publish()
  pump()
  return tempId
}

export const ingestStore = {
  subscribe,
  getSnapshot,
  getServerSnapshot,

  startUrl(url: string) {
    return add('url', url, (progressId, signal) => api.ingestUrl(url, progressId, signal))
  },

  startFile(file: File) {
    return add('file', file.name, (progressId, signal) => api.uploadPDF(file, progressId, signal))
  },

  // Drop a job. For a running one this also aborts the fetch, which detaches
  // the client but does not stop the backend — /ingest-url runs to completion
  // either way. Hence "Remove" rather than "Cancel" in the UI.
  remove(tempId: string) {
    const job = jobs.get(tempId)
    if (!job) return
    stopPolling(job)
    jobs.delete(tempId)
    job.controller.abort()
    publish()
    pump()
  },

  // Re-run a failed job in place, keeping its chip position.
  retry(tempId: string) {
    const job = jobs.get(tempId)
    if (!job || job.status !== 'failed') return
    job.status = 'queued'
    job.error = undefined
    job.stage = null
    job.progressId = crypto.randomUUID()
    job.controller = new AbortController()
    publish()
    pump()
  },

  // Fires when an ingest produces a document. Subscribers apply it to live
  // component state; if nobody is listening the id is still persisted, so the
  // attachment survives to the next mount.
  onResolved(fn: (r: ResolvedIngest) => void) {
    resolvedListeners.add(fn)
    return () => { resolvedListeners.delete(fn) }
  },
}

export function usePendingIngests(): PendingIngest[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

// Jobs that are still going to produce something. Failed ones don't count —
// a queued submit must not wait forever on a chip that will never resolve.
export function usePendingRunningCount(): number {
  const pending = usePendingIngests()
  return pending.filter(p => p.status !== 'failed').length
}
