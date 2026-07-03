import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export interface Concept {
  title: string
  explanation: string
  details: string[]
}

export function parseConcepts(content: string): Concept[] | null {
  try {
    const parsed = JSON.parse(content)
    if (Array.isArray(parsed.concepts)) {
      return parsed.concepts
    }
  } catch {
    // not valid concept JSON — caller falls back to legacy string rendering
  }
  return null
}

function extractContentString(content: string): string {
  let actualContent = content

  try {
    if (content.trim().startsWith('{')) {
      const parsed = JSON.parse(content)
      if (parsed.content) {
        actualContent = parsed.content
      } else if (typeof parsed === 'string') {
        actualContent = parsed
      }
    } else {
      const jsonMatch = content.match(/\{"content":\s*"([^"]+)"/)
      if (jsonMatch) {
        actualContent = jsonMatch[1]
      }
    }
  } catch {
    const contentMatch = content.match(/"content":\s*"([^"]*(?:\\.[^"]*)*)"/)
    if (contentMatch) {
      actualContent = contentMatch[1]
    } else {
      actualContent = content.replace(/^\s*\{\s*"content":\s*"/, '').replace(/"[^}]*\}\s*$/, '')
    }
  }

  actualContent = actualContent.replace(/\\n/g, '\n').replace(/\\"/g, '"')
  actualContent = actualContent.replace(/^[{"]/, '').replace(/[}"]$/, '')

  return actualContent
}

const markdownComponents = {
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="font-serif text-2xl font-light text-white mt-10 mb-5 first:mt-0">{children}</h2>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="font-serif text-xl font-light text-white mt-8 mb-4 first:mt-0">{children}</h3>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h4 className="font-serif text-lg font-medium text-white mt-6 mb-3 border-b border-white/10 pb-2">{children}</h4>
  ),
  h4: ({ children }: { children?: React.ReactNode }) => (
    <h5 className="font-serif text-base font-medium text-white mt-4 mb-2">{children}</h5>
  ),
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="text-white/70 leading-relaxed mb-4">{children}</p>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold text-white">{children}</strong>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="list-disc list-inside space-y-2 my-4 ml-2">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="list-decimal list-inside space-y-2 my-4 ml-2">{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li className="text-white/70 leading-relaxed">{children}</li>
  ),
  hr: () => <hr className="my-6 border-white/10" />,
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="overflow-x-auto my-4">
      <table className="w-full text-sm border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => (
    <thead className="border-b border-white/15">{children}</thead>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="text-left font-medium text-white/80 py-2 pr-4">{children}</th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="text-white/60 py-2 pr-4 border-b border-white/5">{children}</td>
  ),
  code: ({ children }: { children?: React.ReactNode }) => (
    <code className="text-sm bg-white/10 text-[#D7FF3D] px-1.5 py-0.5 rounded">{children}</code>
  ),
}

export function formatSummaryContent(content: string) {
  const actualContent = extractContentString(content)

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {actualContent}
    </ReactMarkdown>
  )
}
