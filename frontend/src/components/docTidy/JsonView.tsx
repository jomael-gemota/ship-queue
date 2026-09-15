import { Fragment, type ReactNode } from 'react'

/**
 * Syntax-highlights pretty-printed JSON by tokenising the rendered text rather
 * than walking the value.
 *
 * Walking the object would mean re-implementing indentation, comma placement and
 * key ordering to match `JSON.stringify`; tokenising its output cannot drift
 * from what the user would get by copying the raw text.
 */
const TOKEN = /("(?:\\.|[^"\\])*"\s*:)|("(?:\\.|[^"\\])*")|(\b-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|(\btrue\b|\bfalse\b)|(\bnull\b)/g

function highlight(json: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0

  TOKEN.lastIndex = 0
  while ((match = TOKEN.exec(json)) !== null) {
    if (match.index > lastIndex) nodes.push(json.slice(lastIndex, match.index))

    const [text, propertyKey, string, num, bool, nul] = match
    const className = propertyKey
      ? 'text-[var(--accent-200)] font-medium'
      : string
        ? 'text-emerald-700 dark:text-emerald-400'
        : num
          ? 'text-violet-700 dark:text-violet-400'
          : bool
            ? 'text-amber-700 dark:text-amber-400'
            : nul
              ? 'text-[var(--text-200)] italic'
              : ''

    nodes.push(
      <span key={key++} className={className}>
        {text}
      </span>
    )
    lastIndex = match.index + text.length
  }

  if (lastIndex < json.length) nodes.push(json.slice(lastIndex))
  return nodes
}

export default function JsonView({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return (
      <p className="px-1 py-8 text-center text-sm text-[var(--text-200)]">
        No structured data yet.
      </p>
    )
  }

  return (
    <pre className="overflow-x-auto rounded-lg border border-[var(--bg-300)] bg-[var(--bg-200)] p-3 font-mono text-xs leading-relaxed text-[var(--text-100)]">
      <code>
        {highlight(JSON.stringify(value, null, 2)).map((node, i) => (
          <Fragment key={i}>{node}</Fragment>
        ))}
      </code>
    </pre>
  )
}
