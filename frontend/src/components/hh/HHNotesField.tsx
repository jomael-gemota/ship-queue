import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent } from 'react'
import { useHHList } from '../../context/HHListContext'

const MAX_NOTES = 4000

function PencilIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L8.25 18.002H5.25v-3L16.862 4.487z"
      />
    </svg>
  )
}

export function HHNotesField({
  groupId,
  orderId,
  notes,
  sourceFileName = '',
  variant = 'cell',
}: {
  groupId: string
  orderId?: string
  notes: string
  sourceFileName?: string
  variant?: 'cell' | 'header'
}) {
  const { updateNotes, updateOrderNotes } = useHHList()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(notes)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const skipBlurRef = useRef(false)
  const savingRef = useRef(false)
  const display = notes || sourceFileName
  const placeholder = sourceFileName || 'Add a note…'
  const label = orderId ? 'Order notes' : 'Batch notes'

  useEffect(() => {
    if (!editing) return
    const el = inputRef.current
    if (!el) return
    el.focus()
    const end = el.value.length
    el.setSelectionRange(end, end)
  }, [editing])

  const startEdit = (event: MouseEvent | KeyboardEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setDraft(notes)
    setError(null)
    setEditing(true)
  }

  const cancel = () => {
    skipBlurRef.current = true
    setDraft(notes)
    setError(null)
    setEditing(false)
  }

  const save = () => {
    if (savingRef.current) return
    const next = draft.trim()
    if (next === notes.trim()) {
      setEditing(false)
      setError(null)
      return
    }
    savingRef.current = true
    setBusy(true)
    setError(null)
    const persist = orderId ? updateOrderNotes(groupId, orderId, next) : updateNotes(groupId, next)
    persist
      .then(() => {
        setEditing(false)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to save notes')
      })
      .finally(() => {
        savingRef.current = false
        setBusy(false)
      })
  }

  if (editing) {
    return (
      <div
        className={variant === 'header' ? 'mt-2 max-w-3xl' : 'min-w-[12rem]'}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <textarea
          ref={inputRef}
          value={draft}
          disabled={busy}
          maxLength={MAX_NOTES}
          rows={variant === 'header' ? 3 : 2}
          placeholder={placeholder}
          aria-label={label}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            if (skipBlurRef.current) {
              skipBlurRef.current = false
              return
            }
            if (!busy) save()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              cancel()
              return
            }
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              save()
            }
          }}
          className="w-full resize-y rounded-md border border-[var(--accent-200)] bg-[var(--bg-100)] px-2 py-1.5 text-[13px] leading-5 text-slate-800 outline-none focus:ring-2 focus:ring-[var(--accent-200)] disabled:opacity-60 dark:bg-[var(--bg-200)] dark:text-[var(--text-100)]"
        />
        <p className="mt-1 text-[11px] text-slate-400 dark:text-[var(--text-200)]">
          Enter to save · Esc to cancel
        </p>
        {error ? <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{error}</p> : null}
      </div>
    )
  }

  const isPlaceholder = !notes
  return (
    <button
      type="button"
      onClick={startEdit}
      title={sourceFileName ? `Click to edit notes · File: ${sourceFileName}` : 'Click to edit notes'}
      className={`group/notes flex w-full items-start gap-1.5 rounded-md text-left cursor-text hover:bg-[var(--primary-100)]/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-200)] ${
        variant === 'header' ? 'mt-2 max-w-3xl px-1 py-0.5' : 'px-0.5 py-0.5'
      }`}
    >
      <span
        className={`min-w-0 flex-1 ${
          isPlaceholder
            ? 'truncate font-medium text-slate-500 dark:text-[var(--text-200)]'
            : 'whitespace-pre-wrap break-words font-medium text-slate-800 dark:text-[var(--text-100)]'
        }`}
      >
        {display || 'Add a note…'}
      </span>
      <PencilIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400 opacity-0 transition-opacity group-hover/notes:opacity-100 group-focus-visible/notes:opacity-100 dark:text-[var(--text-200)]" />
    </button>
  )
}
