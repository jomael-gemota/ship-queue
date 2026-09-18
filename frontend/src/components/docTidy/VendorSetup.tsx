import { useState } from 'react'
import { authApi } from '../../lib/api'
import { Spinner } from './docTidyUi'
import type { DocTidyVendor } from '../../types/docTidy'

/**
 * Registers the vendor the agent could not recognise, capturing one real SKU.
 *
 * Registration is what scopes corrections to a vendor; the sample is a
 * cold-start anchor so the agent reproduces the right SKU shape before any
 * correction exists. The vendor name is also bound to the job, so a re-run
 * resolves it even when nothing in the document spells it out.
 */
export default function VendorSetup({
  jobId,
  workspaceId,
  suggestedName,
  onRegistered,
}: {
  jobId: string
  workspaceId: string
  suggestedName?: string | null
  onRegistered: (vendor: DocTidyVendor) => void
}) {
  const [name, setName] = useState(suggestedName ?? '')
  const [sample, setSample] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [registered, setRegistered] = useState<DocTidyVendor | null>(null)

  const submit = async () => {
    if (!name.trim()) return
    setSaving(true)
    setError(null)

    try {
      const res = await authApi.post<{ data: DocTidyVendor }>('/doc-tidy/vendors', {
        name: name.trim(),
        skuSample: sample.trim() || undefined,
        workspaceId,
      })
      // Bind it to the job too, so the re-run resolves the vendor even if the
      // document never names it.
      await authApi.post(`/doc-tidy/parse-jobs/${jobId}/vendor`, { vendorName: name.trim() })
      // Show success state first so the user sees feedback before the card disappears.
      setRegistered(res.data)
      onRegistered(res.data)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  // Success state — shown while the parent reloads the job and unmounts this card.
  if (registered) {
    return (
      <div className="flex items-center gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900/40 dark:bg-emerald-900/15">
        <svg
          className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-sm text-emerald-800 dark:text-emerald-300">
          <span className="font-semibold">{registered.name}</span> was added to your vendors. Re-run with Tidy Agent to apply it.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/40 dark:bg-amber-900/15">
      <h4 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
        This vendor is new
      </h4>
      <p className="mt-1 text-xs text-amber-800 dark:text-amber-300/90">
        Register it and paste one real SKU. The agent builds this vendor&apos;s SKUs to
        match that shape, and remembers every correction you make for it from then on.
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Vendor name"
          className="rounded-lg border border-[var(--bg-300)] bg-[var(--bg-100)] px-3 py-2 text-sm text-[var(--text-100)] focus:border-[var(--accent-200)] focus:outline-none"
        />
        <input
          value={sample}
          onChange={(e) => setSample(e.target.value)}
          placeholder="One real SKU (optional)"
          className="rounded-lg border border-[var(--bg-300)] bg-[var(--bg-100)] px-3 py-2 font-mono text-sm text-[var(--text-100)] focus:border-[var(--accent-200)] focus:outline-none"
        />
      </div>

      {error && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={saving || !name.trim()}
        className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-lg bg-[var(--accent-200)] px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {saving && <Spinner />}
        Register vendor
      </button>
    </div>
  )
}
