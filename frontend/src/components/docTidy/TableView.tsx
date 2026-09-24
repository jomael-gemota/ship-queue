import type { AgentTable, TableOutput } from '../../types/docTidy'

function cellText(cell: string | number | boolean | null): string {
  if (cell === null || cell === undefined) return ''
  return String(cell)
}

/** Tab-separated, so a copied table pastes straight into a spreadsheet. */
function toTsv(table: AgentTable): string {
  const header = table.columns.join('\t')
  const rows = table.rows.map((row) => row.map(cellText).join('\t'))
  return [header, ...rows].join('\n')
}

function AgentTableView({ table }: { table: AgentTable }) {
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--bg-300)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--bg-300)] bg-[var(--bg-200)] px-3 py-2">
        <h4 className="truncate text-sm font-semibold text-[var(--text-100)]">
          {table.title || 'Table'}
        </h4>
        <button
          type="button"
          onClick={() => void navigator.clipboard.writeText(toTsv(table))}
          className="shrink-0 cursor-pointer rounded-md border border-[var(--bg-300)] px-2 py-1 text-[11px] text-[var(--text-200)] transition-colors hover:bg-[var(--bg-100)] hover:text-[var(--text-100)]"
        >
          Copy
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {table.columns.map((column, i) => (
                <th
                  key={i}
                  className="whitespace-nowrap border-b border-r border-[var(--bg-300)] bg-[var(--bg-200)] px-3 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-[var(--text-200)] last:border-r-0"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, r) => (
              <tr key={r} className="odd:bg-[var(--bg-100)] even:bg-[var(--bg-200)]">
                {table.columns.map((_, c) => (
                  <td
                    key={c}
                    className="border-r border-[var(--bg-300)] px-3 py-1.5 align-top text-[var(--text-100)] last:border-r-0"
                  >
                    {cellText(row[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * The agent's second pass over its own JSON, laid out for reading.
 *
 * Table generation is non-fatal in the worker, so a completed job legitimately
 * has none — that is a missing view, not an error, and says so.
 */
export default function TableView({ output }: { output?: TableOutput | null }) {
  const tables = output?.tables ?? []

  if (tables.length === 0) {
    return (
      <p className="px-1 py-8 text-center text-sm text-[var(--text-200)]">
        No table view for this document. The JSON tab has the full extraction.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {tables.map((table, i) => (
        <AgentTableView key={i} table={table} />
      ))}
    </div>
  )
}
