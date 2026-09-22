import { useEffect, useState } from 'react'
import { checkHHB2bSession, formatCreatedAt, getHHB2bConfig, testHHB2bWebhook, updateHHB2bConfig } from '../lib/hhSportswear'
import type { HHB2bConfig, HHB2bConfigPatch, HHSessionCheck } from '../lib/hhSportswear'
import { useHHList } from '../context/HHListContext'
import { hhBrand } from '../lib/hhBrand'

const inputClass =
  'w-full rounded-lg border border-[var(--bg-300)] bg-[var(--bg-100)] px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--accent-200)] dark:border-[var(--bg-300)] dark:bg-[var(--bg-200)] dark:text-[var(--text-100)]'

const labelClass = 'block text-sm font-medium text-slate-700 dark:text-[var(--text-100)]'
const hintClass = 'block text-xs text-slate-500 dark:text-[var(--text-200)]'
const quietButtonClass =
  'inline-flex cursor-pointer items-center justify-center rounded-lg border border-[var(--bg-300)] bg-[var(--bg-100)] px-3.5 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-[var(--primary-100)] disabled:cursor-not-allowed disabled:opacity-40 dark:border-[var(--bg-300)] dark:text-[var(--text-100)] dark:hover:bg-[var(--primary-100)]'

const MAX_CHECK_TIMES = 12

function formatCheckClock(value: string): string {
  const [hourRaw, minuteRaw] = value.split(':')
  const hour = Number(hourRaw)
  const minute = Number(minuteRaw)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return value
  const suffix = hour >= 12 ? 'PM' : 'AM'
  const hour12 = hour % 12 || 12
  return `${hour12}:${String(minute).padStart(2, '0')} ${suffix}`
}

function nextCheckTime(times: string[]): string {
  for (let hour = 0; hour < 24; hour += 1) {
    const value = `${String(hour).padStart(2, '0')}:00`
    if (!times.includes(value)) return value
  }
  return '12:00'
}

function alertLabel(event: 'failed' | 'recovered' | 'test' | null): string {
  if (event === 'test') return 'Test'
  if (event === 'failed') return 'Failure alert'
  if (event === 'recovered') return 'Recovery alert'
  return 'Alert'
}

function sessionLabel(status: HHSessionCheck['status']): string {
  if (status === 'ok') return 'Working'
  if (status === 'auth') return 'Needs a new cookie'
  if (status === 'down') return 'Not responding'
  return 'Not checked yet'
}

function sessionPillClass(status: HHSessionCheck['status']): string {
  if (status === 'ok') return 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
  if (status === 'auth' || status === 'down') return 'bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300'
  return 'bg-slate-100 text-slate-600 dark:bg-[var(--bg-200)] dark:text-[var(--text-200)]'
}

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
  const [alertWebhookUrl, setAlertWebhookUrl] = useState('')
  const [checkTimes, setCheckTimes] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(false)
  const [testingWebhook, setTestingWebhook] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveNotice, setSaveNotice] = useState<string | null>(null)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [testError, setTestError] = useState<string | null>(null)
  const [testNotice, setTestNotice] = useState<string | null>(null)

  const applySaved = (data: HHB2bConfig) => {
    setSaved(data)
    setBaseUrl(data.baseUrl)
    setCatalog(data.catalog)
    setAccountId(data.accountId)
    setPlaceOrderEnabled(Boolean(data.placeOrderEnabled))
    setAlertWebhookUrl(data.alertWebhookUrl || '')
    setCheckTimes(data.sessionCheckTimes?.length ? data.sessionCheckTimes : [])
    setCookie('')
    setClearCookie(false)
  }

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

  const checkSession = async () => {
    if (checking) return
    setChecking(true)
    setCheckError(null)
    try {
      const res = await checkHHB2bSession(brand)
      setSaved((current) =>
        current
          ? {
              ...current,
              hasCookie: res.data.hasCookie,
              cookieUpdatedAt: res.data.cookieUpdatedAt,
              sessionCheck: res.data.sessionCheck,
              lastAlert: res.data.lastAlert,
            }
          : res.data,
      )
    } catch (error: unknown) {
      setCheckError(error instanceof Error ? error.message : 'Session check failed')
    } finally {
      setChecking(false)
    }
  }

  const sendWebhookTest = async () => {
    if (testingWebhook) return
    setTestingWebhook(true)
    setTestError(null)
    setTestNotice(null)
    try {
      const res = await testHHB2bWebhook(brand)
      setSaved((current) => (current ? { ...current, lastAlert: res.data.lastAlert } : res.data))
      if (res.data.lastAlert.error) setTestError(res.data.lastAlert.error)
      else setTestNotice('Test sent.')
    } catch (error: unknown) {
      setTestError(error instanceof Error ? error.message : 'Webhook test failed')
    } finally {
      setTestingWebhook(false)
    }
  }

  const save = async () => {
    if (busy) return
    setBusy(true)
    setSaveError(null)
    setSaveNotice(null)
    setTestError(null)
    setTestNotice(null)
    try {
      const patch: HHB2bConfigPatch = {
        baseUrl,
        catalog,
        accountId,
        placeOrderEnabled,
        alertWebhookUrl,
        sessionCheckTimes: checkTimes,
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

  const savedWebhook = (saved?.alertWebhookUrl || '').trim()
  const webhookDirty = alertWebhookUrl.trim() !== savedWebhook
  const scheduleLabel =
    checkTimes.length > 0
      ? `Daily at ${checkTimes.map(formatCheckClock).join(', ')}, Philippines time.`
      : 'No daily check until you add a time.'

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

      <div className="space-y-3 border-t border-[var(--bg-300)] pt-5 dark:border-[var(--bg-300)]">
        <div className="flex flex-wrap items-center gap-2">
          <span className={labelClass}>Session check</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${sessionPillClass(saved?.sessionCheck.status ?? null)}`}>
            {sessionLabel(saved?.sessionCheck.status ?? null)}
          </span>
        </div>
        <p className={hintClass}>
          {saved?.sessionCheck.checkedAt
            ? `Last checked ${formatCreatedAt(saved.sessionCheck.checkedAt)}.`
            : 'No check has run yet.'}{' '}
          A check reads the catalog only. It does not create a draft or place an order.
          {saved?.sessionCheck.latencyMs != null && saved.sessionCheck.status === 'ok'
            ? ` Responded in ${saved.sessionCheck.latencyMs} ms.`
            : ''}
        </p>
        <div className="space-y-2">
          <span className={labelClass}>Check times</span>
          <p className={hintClass}>{scheduleLabel} Save to apply. The clock is Philippines time (PHT).</p>
          {checkTimes.length > 0 ? (
            <ul className="space-y-2">
              {checkTimes.map((time, index) => (
                <li key={index} className="flex items-center gap-2">
                  <input
                    type="time"
                    aria-label={`Check time ${index + 1}`}
                    className={`${inputClass} w-40`}
                    value={time}
                    disabled={busy}
                    onChange={(event) => {
                      const next = [...checkTimes]
                      next[index] = event.target.value
                      setCheckTimes(next)
                    }}
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setCheckTimes(checkTimes.filter((_, itemIndex) => itemIndex !== index))}
                    className="cursor-pointer px-2 py-2 text-sm font-medium text-slate-600 underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-40 dark:text-[var(--text-200)]"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <button
            type="button"
            disabled={busy || checkTimes.length >= MAX_CHECK_TIMES}
            onClick={() => setCheckTimes((current) => [...current, nextCheckTime(current)])}
            className={quietButtonClass}
          >
            Add time
          </button>
        </div>
        {saved?.sessionCheck.message && saved.sessionCheck.status && saved.sessionCheck.status !== 'ok' ? (
          <p className="text-sm text-red-700 dark:text-red-300">{saved.sessionCheck.message}</p>
        ) : null}
        <div className="space-y-1.5">
          <label className={labelClass} htmlFor="hh-b2b-webhook">
            Alert webhook
          </label>
          <input
            id="hh-b2b-webhook"
            className={inputClass}
            value={alertWebhookUrl}
            onChange={(event) => setAlertWebhookUrl(event.target.value)}
            placeholder="https://example.com/hooks/hh-b2b"
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
          />
          <p className={hintClass}>
            Saved with the form. When a check starts failing, Ship Queue POSTs JSON to this URL, and again when the
            session recovers. Repeat failures stay quiet. The body includes{' '}
            <span className="font-mono">event</span>, <span className="font-mono">brand</span>,{' '}
            <span className="font-mono">status</span>, <span className="font-mono">message</span>, and{' '}
            <span className="font-mono">checkedAt</span>. Send test uses <span className="font-mono">event: test</span>{' '}
            and does not check the session. Leave blank to keep the result in this app only.
          </p>
          {saved?.lastAlert.at ? (
            <p className={saved.lastAlert.error ? 'text-xs text-red-600 dark:text-red-400' : hintClass}>
              {alertLabel(saved.lastAlert.event)} {formatCreatedAt(saved.lastAlert.at)}
              {saved.lastAlert.error ? ` — ${saved.lastAlert.error}` : ''}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={checking || busy}
            onClick={() => {
              void checkSession()
            }}
            className={quietButtonClass}
          >
            {checking ? 'Checking…' : 'Check session'}
          </button>
          <button
            type="button"
            disabled={testingWebhook || busy || !savedWebhook || webhookDirty}
            onClick={() => {
              void sendWebhookTest()
            }}
            className={quietButtonClass}
          >
            {testingWebhook ? 'Sending…' : 'Send test'}
          </button>
          <span className={hintClass}>
            {webhookDirty
              ? 'Save the webhook URL before sending a test.'
              : savedWebhook
                ? 'Send test uses the saved URL and does not check the session.'
                : 'Save a webhook URL to send a test.'}
          </span>
          {checkError ? <span className="text-sm text-red-600 dark:text-red-400">{checkError}</span> : null}
          {testNotice ? <span className="text-sm text-emerald-700 dark:text-emerald-300">{testNotice}</span> : null}
          {testError ? <span className="text-sm text-red-600 dark:text-red-400">{testError}</span> : null}
        </div>
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
