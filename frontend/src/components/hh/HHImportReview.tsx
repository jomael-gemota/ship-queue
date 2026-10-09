import { importOutputRowKey, type HHImportOutputRow, type HHImportReview } from '../../lib/hhSportswear'

function rowNote(row: HHImportOutputRow, included: boolean): string | null {
  if (row.looksSwapped) {
    return included ? 'Included. PO looks like the Order ID.' : 'Left out. PO looks like the Order ID.'
  }
  if (row.oddOrderId) {
    return included ? 'Included. Not an Amazon order id.' : 'Left out. Not an Amazon order id.'
  }
  const parts: string[] = []
  if (row.sharedOrderId) parts.push('Same Order ID on another row')
  if (row.sharedPo) parts.push('Same PO on another row')
  return parts.length ? `${parts.join('. ')}.` : null
}

function prepNotes(review: HHImportReview): string[] {
  const notes: string[] = []
  if (review.duplicateRowsSkipped > 0) {
    notes.push(
      review.duplicateRowsSkipped === 1
        ? '1 duplicate row was collapsed. The first copy is in this list.'
        : `${review.duplicateRowsSkipped} duplicate rows were collapsed. The first copy of each is in this list.`,
    )
  }
  if (review.incompleteRowsSkipped > 0) {
    notes.push(
      review.incompleteRowsSkipped === 1
        ? '1 row is missing a PO or an Order ID, so it is not in this list.'
        : `${review.incompleteRowsSkipped} rows are missing a PO or an Order ID, so they are not in this list.`,
    )
  }
  if (review.oddOrderIdCount > 0) {
    notes.push('Rows that do not look like an Amazon order id start left out. Check a row to include it.')
  }
  return notes
}

export function HHImportPreviewTable({
  review,
  excluded,
  disabled,
  onToggle,
  onSetExcluded,
}: {
  review: HHImportReview
  excluded: Set<string>
  disabled?: boolean
  onToggle: (key: string) => void
  onSetExcluded: (keys: string[]) => void
}) {
  const notes = prepNotes(review)
  const rows = review.rows ?? []
  if (rows.length === 0 && notes.length === 0) return null

  const includedCount = rows.filter((row) => !excluded.has(importOutputRowKey(row))).length
  const allIncluded = rows.length > 0 && includedCount === rows.length
  const noneIncluded = includedCount === 0

  return (
    <div className="space-y-2">
      {notes.length > 0 && (
        <ul className="space-y-1 text-xs leading-5 text-amber-950 dark:text-amber-200">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
      {rows.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-[var(--bg-300)] dark:border-[var(--bg-300)]">
          <div className="max-h-44 overflow-y-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 z-10 bg-[var(--bg-100)] text-slate-500 dark:bg-[var(--bg-100)] dark:text-[var(--text-200)]">
                <tr className="border-b border-[var(--bg-300)]">
                  <th className="w-10 px-3 py-2 font-medium">
                    <input
                      type="checkbox"
                      className="cursor-pointer accent-[var(--accent-200)]"
                      checked={allIncluded}
                      disabled={disabled}
                      aria-label={allIncluded ? 'Leave out all orders' : 'Include all orders'}
                      ref={(element) => {
                        if (element) element.indeterminate = !allIncluded && !noneIncluded
                      }}
                      onChange={() => onSetExcluded(allIncluded ? rows.map(importOutputRowKey) : [])}
                    />
                  </th>
                  <th className="px-2 py-2 font-semibold">PO</th>
                  <th className="px-3 py-2 font-semibold">Order ID</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const key = importOutputRowKey(row)
                  const included = !excluded.has(key)
                  const flagged = row.oddOrderId || row.sharedOrderId || row.sharedPo
                  const note = rowNote(row, included)
                  return (
                    <tr
                      key={key}
                      className={`border-b border-[var(--bg-300)] last:border-b-0 ${
                        flagged ? 'bg-amber-50 dark:bg-amber-900/15' : ''
                      }`}
                    >
                      <td className="px-3 py-2 align-top">
                        <input
                          type="checkbox"
                          className="mt-0.5 cursor-pointer accent-[var(--accent-200)]"
                          checked={included}
                          disabled={disabled}
                          aria-label={`${included ? 'Leave out' : 'Include'} PO ${row.po}`}
                          onChange={() => onToggle(key)}
                        />
                      </td>
                      <td
                        className={`px-2 py-2 align-top font-mono text-[11px] break-all text-slate-800 dark:text-[var(--text-100)] ${
                          included ? '' : 'text-slate-400 line-through dark:text-[var(--text-200)]'
                        }`}
                      >
                        {row.po}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <div
                          className={`font-mono text-[11px] break-all text-slate-800 dark:text-[var(--text-100)] ${
                            included ? '' : 'text-slate-400 line-through dark:text-[var(--text-200)]'
                          }`}
                        >
                          {row.orderId}
                        </div>
                        {note && (
                          <p className="mt-0.5 text-[11px] leading-4 text-amber-800 dark:text-amber-300">{note}</p>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
