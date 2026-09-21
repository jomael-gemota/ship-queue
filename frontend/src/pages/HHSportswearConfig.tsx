import { useEffect, useState } from 'react'
import { formatCreatedAt, getHHB2bConfig, updateHHB2bConfig } from '../lib/hhSportswear'
import type { HHB2bConfig, HHB2bConfigPatch } from '../lib/hhSportswear'
import { useHHList } from '../context/HHListContext'
import { hhBrand } from '../lib/hhBrand'

const inputClass =
  'w-full rounded-lg border border-[var(--bg-300)] bg-[var(--bg-100)] px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--accent-200)] dark:border-[var(--bg-300)] dark:bg-[var(--bg-200)] dark:text-[var(--text-100)]'

const labelClass = 'block text-sm font-medium text-slate-700 dark:text-[var(--text-100)]'
const hintClass = 'block text-xs text-slate-500 dark:text-[var(--text-200)]'

export default function HHSportswearConfig() {
  const { brand, setPlaceOrderEnabled: setPlaceOrderEnabledContext } = useHHList()
  const brandDef = hhBrand(brand)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saved, setSaved] = useState<HHB2bConfig | null>(null)
  const [baseUrl, setBaseUrl] = useState('')
  const [catalog, setCatalog] = useState('')
  const [accountId, setAccountId] = useState('')
  const [cookie, setCookie] = useState('')
  const [clearCookie, setClearCookie] = useState(false)
  const [placeOrderEnabled, setPlaceOrderEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveNotice, setSaveNotice] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoadState('loading')
    getHHB2bConfig(brand)
      .then((res) => {
        if (cancelled) return
        applySaved(res.data)
        setLoadState('ready')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setLoadError(error instanceof Error ? error.message : 'Failed to load configurations')
        setLoadState('error')
      })
    return () => {
      cancelled = true
    }
  }, [brand])

  const applySaved = (data: HHB2bConfig) => {
    setSaved(data)
    setBaseUrl(data.baseUrl)
    setCatalog(data.catalog)
    setAccountId(data.accountId)
    setPlaceOrderEnabled(Boolean(data.placeOrderEnabled))
    setCookie('')
    setClearCookie(false)
  }

  const save = async () => {
    if (busy) return
    setBusy(true)
    setSaveError(null)
    setSaveNotice(null)
    try {
      const patch: HHB2bConfigPatch = {
        baseUrl,
        catalog,
        accountId,
        placeOrderEnabled,
      }
      if (clearCookie) patch.cookie = ''
      else if (cookie.trim()) patch.cookie = cookie
      const res = await updateHHB2bConfig(brand, patch)
      applySaved(res.data)
      setPlaceOrderEnabledContext(Boolean(res.data.placeOrderEnabled))
      setSaveNotice('Saved.')
    } catch (error: unknown) {
      setSaveError(error instanceof Error ? error.message : 'Failed to save configurations')
    } finally {
      setBusy(false)
    }
  }

  if (loadState === 'loading') {
    return <p className="px-5 py-8 text-sm text-slate-500 dark:text-[var(--text-200)]">Loading configurations…</p>
  }

  if (loadState === 'error') {
    return <p className="px-5 py-8 text-sm text-red-600 dark:text-red-400">{loadError}</p>
  }

  return (
    <form
      className="space-y-6 px-5 py-5"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-slate-900 dark:text-[var(--text-100)]">
          B2B {brand === 'workwear' ? 'Work' : 'Sports'} account
        </h2>
        <p className="text-sm text-slate-500 dark:text-[var(--text-200)]">
          Cart drafts POST to this {brandDef.supplier} B2B account. Sphere does not refresh the session — paste a
          cookie from a logged-in browser. Place Order stays off until you enable it below.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <label className={labelClass} htmlFor="hh-b2b-base-url">
            Base URL
          </label>
          <input
            id="hh-b2b-base-url"
            className={inputClass}
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <p className={hintClass}>
            {brand === 'workwear' ? 'Work' : 'Sports'} portal, e.g. {brandDef.baseUrl}
          </p>
        </div>

        <div className="space-y-1.5">
          <label className={labelClass} htmlFor="hh-b2b-catalog">
            Catalog
          </label>
          <input
            id="hh-b2b-catalog"
            className={inputClass}
            value={catalog}
            onChange={(event) => setCatalog(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <p className={hintClass}>
            {brandDef.catalog} for {brand === 'workwear' ? 'Work' : 'Sports'}; not the Fashion catalog.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className={labelClass} htmlFor="hh-b2b-account-id">
            Account ID
          </label>
          <input
            id="hh-b2b-account-id"
            className={inputClass}
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <p className={hintClass}>
            B2B customer number sent as <span className="font-mono">customer</span>.
          </p>
        </div>
      </div>

      <div className="space-y-2 border-t border-[var(--bg-300)] pt-5 dark:border-[var(--bg-300)]">
        <div className="flex items-start gap-3 rounded-xl border border-[var(--bg-300)] bg-[var(--bg-200)]/40 px-3.5 py-3 dark:border-[var(--bg-300)] dark:bg-[var(--bg-200)]/40">
          <div className="min-w-0 flex-1">
            <p className={labelClass}>Place Order</p>
            <p className={`mt-0.5 ${hintClass}`}>
              {placeOrderEnabled
                ? 'Enabled. Place Order re-checks the live cart, then submits matching Ready orders to Helly Hansen.'
                : 'Off. Place Order still appears and re-checks the live cart, but Helly Hansen does not receive a submit.'}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={placeOrderEnabled}
            aria-label="Place Order enabled"
            disabled={busy}
            onClick={() => setPlaceOrderEnabled((current) => !current)}
            className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
              busy ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
            } ${placeOrderEnabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-[var(--bg-300)]'}`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                placeOrderEnabled ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
      </div>

      <div className="space-y-2 border-t border-[var(--bg-300)] pt-5 dark:border-[var(--bg-300)]">
        <div className="flex flex-wrap items-center gap-2">
          <span className={labelClass}>Session cookie</span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              saved?.hasCookie
                ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                : 'bg-slate-100 text-slate-600 dark:bg-[var(--bg-200)] dark:text-[var(--text-200)]'
            }`}
          >
            {saved?.hasCookie ? 'Stored' : 'None'}
          </span>
        </div>
        {saved?.hasCookie && saved.cookieUpdatedAt ? (
          <p className={hintClass}>Last updated {formatCreatedAt(saved.cookieUpdatedAt)}</p>
        ) : (
          <p className={hintClass}>
            Paste the Cookie header from a logged-in {brandDef.baseUrl.replace(/^https?:\/\//, '')} tab. It is never
            shown again.
          </p>
        )}
        <textarea
          id="hh-b2b-cookie"
          className={`${inputClass} min-h-[7rem] font-mono text-xs`}
          value={cookie}
          onChange={(event) => {
            setCookie(event.target.value)
            if (event.target.value.trim()) setClearCookie(false)
          }}
          placeholder={saved?.hasCookie ? 'Leave blank to keep the stored session' : 'sessionid=…; csrftoken=…'}
          autoComplete="off"
          spellCheck={false}
          disabled={clearCookie || busy}
          aria-label="Session cookie"
        />
        {saved?.hasCookie ? (
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-[var(--text-200)]">
            <input
              type="checkbox"
              checked={clearCookie}
              onChange={(event) => {
                setClearCookie(event.target.checked)
                if (event.target.checked) setCookie('')
              }}
              disabled={busy}
            />
            Clear the stored session
          </label>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex cursor-pointer items-center justify-center rounded-lg bg-[var(--accent-200)] px-3.5 py-2 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-[var(--accent-100)] dark:text-[var(--text-100)]"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        {saveNotice ? <span className="text-sm text-emerald-700 dark:text-emerald-300">{saveNotice}</span> : null}
        {saveError ? <span className="text-sm text-red-600 dark:text-red-400">{saveError}</span> : null}
        {saved?.updatedAt ? (
          <span className={hintClass}>
            Saved {formatCreatedAt(saved.updatedAt)}
            {saved.updatedByName ? ` by ${saved.updatedByName}` : ''}
          </span>
        ) : null}
      </div>
    </form>
  )
}
