'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import BloomApp from '@/components/BloomApp'

function UploadContent() {
  const searchParams = useSearchParams()
  // The query string is user-editable, so validate rather than cast — an
  // unrecognised step (including the retired 'configure') falls back to the
  // entry screen instead of rendering an undefined branch.
  const step = searchParams.get('step')
  const initialStep = step === 'lesson' ? 'lesson' : 'upload'

  return <BloomApp initialStep={initialStep} />
}

export default function UploadPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <UploadContent />
    </Suspense>
  )
} 