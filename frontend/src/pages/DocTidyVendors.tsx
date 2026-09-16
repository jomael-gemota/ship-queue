import { useCallback, useEffect, useState } from 'react'
import { authApi } from '../lib/api'
import { Banner, DocTidyTabs, IconButton, Spinner } from '../components/docTidy/docTidyUi'
import { vendorSamples, type DocTidyVendor } from '../types/docTidy'

/**
 * The vendors the agent knows, and the SKU formats it anchors on.
 *
 * A vendor is not decoration: registering one is what scopes corrections to it,
 * so a format learned from an Acme invoice is never applied to anyone else's.
 * The correction count is therefore the interesting column — it says how much
 * this vendor has actually taught the agent, as opposed to merely existing.
 */
export default function DocTidyVendors() {
  const [vendors, setVendors] = useState<DocTidyVendor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [sample, setSample] = useState('')
  const [saving, setSaving] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<DocTidyVendor | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await authApi.get<{ data: DocTidyVendor[] }>('/doc-tidy/vendors')
      setVendors(res.data)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const addVendor = async () => {
    if (!name.trim()) return
    setSaving(true)
    setError(null)
    try {
      await authApi.post('/doc-tidy/vendors', {
        name: name.trim(),
        skuSample: sample.trim() || undefined,
      })
      setName('')
      setSample('')
      setNotice('Vendor saved.')
      await load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const removeSample = async (vendor: DocTidyVendor, skuSample: string) => {
    try {
      await authApi.post(`/doc-tidy/vendors/${encodeURIComponent(vendor.name)}/samples/remove`, {
        skuSample,
      })
      await load()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const confirmDelete = async () => {
    if (!pendingDelete) return
    try {
      const res = await authApi.delete<{ data: { correctionsDeleted: number } }>(
        `/doc-tidy/vendors/${encodeURIComponent(pendingDelete.name)}`
      )
      setNotice(
        res.data.correctionsDeleted > 0
          ? `Deleted ${pendingDelete.name} and ${res.data.correctionsDeleted} correction(s) it had taught the agent.`
          : `Deleted ${pendingDelete.name}.`
      )
      setPendingDelete(null)
      await load()
    } catch (err) {
      setError((err as Error).message)
      setPendingDelete(null)
    }
  }

  return (
    <div className="space-y-4">
      {/* ── Tab bar ───────────────────────────────────────────────── */}
      <div className="border-b border-[var(--bg-300)]">
        <DocTidyTabs />
      </div>

      {error && (
        <Banner kind="error" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}
      {notice && (
        <Banner kind="success" onDismiss={() => setNotice(null)}>
          {notice}
        </Banner>
      )}

      <div className="rounded-xl border border-[var(--bg-300)] bg-[var(--bg-100)] p-4">
        <h3 className="text-sm font-semibold text-[var(--text-100)]">Register a vendor</h3>
        <p className="mt-1 text-xs text-[var(--text-200)]">
          Paste one real SKU so the agent reproduces this vendor&apos;s format on its very
          first document, before you have corrected anything.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Vendor name"
            className="min-w-[200px] flex-1 rounded-lg border border-[var(--bg-300)] bg-[var(--bg-100)] px-3 py-2 text-sm text-[var(--text-100)] focus:border-[var(--accent-200)] focus:outline-none"
          />
          <input
            value={sample}
            onChange={(e) => setSample(e.target.value)}
            placeholder="Sample SKU (optional)"
            className="min-w-[200px] flex-1 rounded-lg border border-[var(--bg-300)] bg-[var(--bg-100)] px-3 py-2 font-mono text-sm text-[var(--text-100)] focus:border-[var(--accent-200)] focus:outline-none"
          />
          <button
            type="button"
            onClick={addVendor}
            disabled={saving || !name.trim()}
            className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-[var(--accent-200)] px-3.5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving && <Spinner />}
            Save
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-[var(--bg-300)] bg-[var(--bg-100)]">
        {loading ? (
          <div className="px-6 py-12 text-center text-sm text-[var(--text-200)]">
            <span className="inline-flex items-center gap-2">
              <Spinner /> Loading vendors…
            </span>
          </div>
        ) : vendors.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-[var(--text-200)]">
            No vendors yet. One is registered automatically the first time you set one up
            from a parsed document.
          </div>
        ) : (
          <ul className="divide-y divide-[var(--bg-300)]">
            {vendors.map((vendor) => {
              const samples = vendorSamples(vendor)

              return (
                <li key={vendor._id} className="flex items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-[var(--text-100)]">{vendor.name}</span>
                      <span className="rounded-full bg-[var(--primary-100)] px-2 py-0.5 text-[11px] font-medium text-[var(--accent-200)]">
                        {vendor.correctionCount} correction
                        {vendor.correctionCount === 1 ? '' : 's'}
                      </span>
                    </div>

                    {samples.length === 0 ? (
                      <p className="mt-1.5 text-xs italic text-[var(--text-200)]">
                        No sample SKU — the agent guesses this vendor&apos;s format until you
                        correct one.
                      </p>
                    ) : (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {samples.map((skuSample) => (
                          <span
                            key={skuSample}
                            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--bg-300)] bg-[var(--bg-200)] px-2 py-1 font-mono text-[11px] text-[var(--text-100)]"
                          >
                            {skuSample}
                            <button
                              type="button"
                              onClick={() => removeSample(vendor, skuSample)}
                              aria-label={`Remove sample ${skuSample}`}
                              className="cursor-pointer opacity-60 hover:opacity-100"
                            >
                              ✕
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <IconButton
                    label="Delete vendor"
                    tone="danger"
                    onClick={() => setPendingDelete(vendor)}
                    iconPath="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/25 backdrop-blur-[2px]"
            onClick={() => setPendingDelete(null)}
            aria-hidden
          />
          <div
            role="dialog"
            aria-modal="true"
            className="relative z-10 w-full max-w-sm rounded-xl border border-[var(--bg-300)] bg-[var(--bg-100)] p-5 shadow-xl"
          >
            <h3 className="text-base font-semibold text-[var(--text-100)]">
              Delete {pendingDelete.name}?
            </h3>
            <p className="mt-2 text-sm text-[var(--text-200)]">
              {pendingDelete.correctionCount > 0
                ? `This also deletes the ${pendingDelete.correctionCount} correction(s) this vendor taught the agent, so it will go back to guessing their format.`
                : 'This vendor has taught the agent nothing yet, so only the profile is removed.'}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                className="cursor-pointer rounded-lg border border-[var(--bg-300)] px-3 py-1.5 text-sm text-[var(--text-200)] transition-colors hover:bg-[var(--bg-200)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                className="cursor-pointer rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
