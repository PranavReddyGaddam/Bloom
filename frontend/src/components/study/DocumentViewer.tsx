'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { DocumentOriginalMeta } from '@/types'
import { ChevronLeft, ChevronRight, Download, Loader2 } from 'lucide-react'

const LIME = 'text-[#D7FF3D]'

// Shows the file the student actually uploaded, not just the text extracted
// from it. That matters because extraction is lossy in ways they can't see:
// title pages keep only their first line, figures become prose descriptions,
// and anything past the assembly budget is dropped silently.
//
// Pages are PNGs rendered server-side by PyMuPDF rather than a client-side PDF
// library — the backend already had the renderer, it works the same for every
// browser, and it avoids shipping a heavy dependency for one screen.
export function DocumentViewer({
  documentId,
  filename,
}: {
  documentId: string
  filename: string
}) {
  const [meta, setMeta] = useState<DocumentOriginalMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  // The image is only revealed once decoded — a cold page is a storage fetch
  // plus a render, and a half-drawn swap reads as a glitch.
  const [pageLoaded, setPageLoaded] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const result = await api.getDocumentOriginalMeta(documentId)
        if (!cancelled) setMeta(result)
      } catch {
        // Treated the same as "no original": this panel is supplementary, and
        // an error box here would be louder than the feature is important.
        if (!cancelled) setMeta(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [documentId])

  const pageCount = meta?.page_count ?? 0
  const template = meta?.page_url_template
  const pageUrl = useCallback(
    (n: number) => template?.replace('{page}', String(n)) ?? '',
    [template],
  )

  const goTo = useCallback((next: number) => {
    if (next < 0 || next >= pageCount) return
    setPageLoaded(false)
    setPage(next)
  }, [pageCount])

  // Warm the next page while the current one is being read, so the common
  // forward-read doesn't wait on a round trip.
  useEffect(() => {
    if (!template || page + 1 >= pageCount) return
    const img = new Image()
    img.src = pageUrl(page + 1)
  }, [page, pageCount, template, pageUrl])

  // Arrow keys, but only while the viewer holds focus — this is one row in a
  // list, so hijacking the document's arrow keys would be wrong.
  const onKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); goTo(page - 1) }
    if (event.key === 'ArrowRight') { event.preventDefault(); goTo(page + 1) }
  }, [goTo, page])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-white/40 p-4">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading the original…
      </div>
    )
  }

  if (!meta || !meta.available) {
    return (
      <p className="text-sm text-white/40 p-4">
        The original file isn&apos;t available for this document — only the text
        we extracted from it.
      </p>
    )
  }

  const downloadLink = meta.download_url && (
    <a
      href={meta.download_url}
      className={`inline-flex items-center gap-1.5 text-xs ${LIME} hover:underline`}
    >
      <Download className="h-3.5 w-3.5" />
      Download original
    </a>
  )

  // Non-PDF: we keep the file but can't page through it, since rendering DOCX
  // or PPTX would mean shipping LibreOffice. Downloading is the honest option.
  if (!meta.is_pdf) {
    return (
      <div className="p-4 space-y-2">
        <p className="text-sm text-white/50">
          This file can&apos;t be previewed here, but you can open your copy.
        </p>
        {downloadLink}
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="rounded-xl border border-white/10 bg-white/5 p-4 focus:outline-none focus:ring-1 focus:ring-[#D7FF3D]/40"
    >
      <div className="relative flex justify-center bg-black/20 rounded-lg overflow-hidden min-h-[12rem]">
        {!pageLoaded && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-white/30" />
          </div>
        )}
        {/* Not next/image: these are token-authenticated, dynamically sized,
            API-origin URLs, so the optimizer adds nothing and would need
            remote-pattern config. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={page}
          src={pageUrl(page)}
          alt={`Page ${page + 1} of ${filename}`}
          onLoad={() => setPageLoaded(true)}
          onError={() => setPageLoaded(true)}
          className={`max-w-full h-auto transition-opacity duration-200 ${
            pageLoaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
      </div>

      <div className="flex items-center justify-between gap-3 mt-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => goTo(page - 1)}
            disabled={page === 0}
            aria-label="Previous page"
            className="rounded-lg border border-white/20 bg-white/5 p-1.5 text-white/70 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-30 disabled:hover:bg-white/5"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-xs text-white/50 tabular-nums" aria-live="polite">
            Page {page + 1} of {pageCount}
          </span>
          <button
            type="button"
            onClick={() => goTo(page + 1)}
            disabled={page + 1 >= pageCount}
            aria-label="Next page"
            className="rounded-lg border border-white/20 bg-white/5 p-1.5 text-white/70 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-30 disabled:hover:bg-white/5"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        {downloadLink}
      </div>
    </div>
  )
}
