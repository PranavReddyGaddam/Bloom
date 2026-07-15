'use client'

import { useMemo } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'

// Matches the delimiters the LLM emits: \( inline \), \[ display \],
// and $$ display $$. Plain-text segments between matches pass through.
const MATH_PATTERN = /\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]|\$\$([\s\S]+?)\$\$/g

function renderMath(latex: string, displayMode: boolean): string {
  return katex.renderToString(latex, {
    displayMode,
    throwOnError: false, // malformed LaTeX renders best-effort in red instead of crashing
    output: 'html',
  })
}

/**
 * Renders a plain string that may contain LaTeX math segments. Text outside
 * the math delimiters is rendered as-is (no markdown, no HTML injection —
 * only KaTeX's own output is inserted as HTML).
 */
export function MathText({ text, className }: { text: string; className?: string }) {
  const parts = useMemo(() => {
    const out: { key: number; math?: string; display?: boolean; plain?: string }[] = []
    let last = 0
    let key = 0
    for (const match of text.matchAll(MATH_PATTERN)) {
      if (match.index! > last) {
        out.push({ key: key++, plain: text.slice(last, match.index) })
      }
      const [, inline, display, dollars] = match
      out.push({ key: key++, math: inline ?? display ?? dollars, display: inline === undefined })
      last = match.index! + match[0].length
    }
    if (last < text.length) {
      out.push({ key: key++, plain: text.slice(last) })
    }
    return out
  }, [text])

  return (
    <span className={className}>
      {parts.map(part =>
        part.math !== undefined ? (
          <span
            key={part.key}
            dangerouslySetInnerHTML={{ __html: renderMath(part.math, part.display ?? false) }}
          />
        ) : (
          <span key={part.key}>{part.plain}</span>
        )
      )}
    </span>
  )
}
