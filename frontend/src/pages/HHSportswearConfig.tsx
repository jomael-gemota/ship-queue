import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { checkHHB2bSession, formatCreatedAt, getHHB2bConfig, testHHB2bWebhook, updateHHB2bConfig } from '../lib/hhSportswear'
import type { HHB2bConfig, HHB2bConfigPatch, HHSessionCheck } from '../lib/hhSportswear'
import { useHHList } from '../context/HHListContext'
import { hhBrand, hhUsesOrderDetailsDraft } from '../lib/hhBrand'
import {
  THOROGOOD_SKU_SAMPLES,
  normalizeThorogoodSkuInitials,
  thorogoodPortalSku,
} from '../lib/hhThorogoodSku'
import { normalizeHhSkuExcludes } from '../lib/hhSkuExclude'

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

function initialsFromText(text: string): { initials: string[] } | { error: string } {
  return normalizeThorogoodSkuInitials(text.split(/\r?\n/))
}

function excludesFromText(text: string): { excludes: string[] } | { error: string } {
  return normalizeHhSkuExcludes(text.split(/\r?\n/))
}

function sameExcludes(text: string, saved: string[]): boolean {
  const parsed = excludesFromText(text)
  if ('error' in parsed) return false
  if (parsed.excludes.length !== saved.length) return false
  return parsed.excludes.every((token, index) => token === saved[index])
}

function sameInitials(text: string, saved: string[]): boolean {
  const parsed = initialsFromText(text)
  if ('error' in parsed) return false
  if (parsed.initials.length !== saved.length) return false
  return parsed.initials.every((initial, index) => initial === saved[index])
}

function sameCheckTimes(current: string[], saved: string[]): boolean {
  if (current.length !== saved.length) return false
  return current.every((time, index) => time === saved[index])
}

function ConfigSection({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="rounded-xl border border-[var(--bg-300)] bg-[var(--bg-200)]/30 px-4 py-4 dark:border-[var(--bg-300)]">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-[var(--text-100)]">{title}</h3>
        <p className="mt-0.5 text-xs leading-5 text-slate-500 dark:text-[var(--text-200)]">{description}</p>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

function sessionPillClass(status: HHSessionCheck['status']): string {
  if (status === 'ok') return 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
  if (status === 'auth' || status === 'down') return 'bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300'
  return 'bg-slate-100 text-slate-600 dark:bg-[var(--bg-200)] dark:text-[var(--text-200)]'
}

export default function HHSportswearConfig() {
  const { brand, setPlaceOrderEnabled: setPlaceOrderEnabledContext } = useHHList()
  const brandDef = hhBrand(brand)
  const orderDetails = hhUsesOrderDetailsDraft(brand)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saved, setSaved] = useState<HHB2bConfig | null>(null)
  const [baseUrl, setBaseUrl] = useState('')
  const [catalog, setCatalog] = useState('')
  const [accountId, setAccountId] = useState('')
  const [cookie, setCookie] = useState('')
  const [skuInitialsText, setSkuInitialsText] = useState('')
  const [skuExcludesText, setSkuExcludesText] = useState('')
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
    setSkuInitialsText((data.skuInitials ?? []).join('\n'))
    setSkuExcludesText((data.skuExcludes ?? []).join('\n'))
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

  const savedTimes = saved?.sessionCheckTimes ?? []
  const dirty =
    saved != null &&
    (baseUrl !== saved.baseUrl ||
      alertWebhookUrl !== (saved.alertWebhookUrl || '') ||
      !sameCheckTimes(checkTimes, savedTimes) ||
      (!orderDetails &&
        (catalog !== saved.catalog ||
          accountId !== saved.accountId ||
          placeOrderEnabled !== Boolean(saved.placeOrderEnabled) ||
          !sameExcludes(skuExcludesText, saved.skuExcludes ?? []))) ||
      cookie.trim().length > 0 ||
      clearCookie ||
      (orderDetails && !sameInitials(skuInitialsText, saved.skuInitials ?? [])))

  const save = async () => {
    if (busy || !dirty) return
    setBusy(true)
    setSaveError(null)
    setSaveNotice(null)
    setTestError(null)
    setTestNotice(null)
    try {
      const parsedInitials = orderDetails ? initialsFromText(skuInitialsText) : null
      if (parsedInitials && 'error' in parsedInitials) {
        setSaveError(parsedInitials.error)
        setBusy(false)
        return
      }
      const parsedExcludes = orderDetails ? null : excludesFromText(skuExcludesText)
      if (parsedExcludes && 'error' in parsedExcludes) {
        setSaveError(parsedExcludes.error)
        setBusy(false)
        return
      }
      const patch: HHB2bConfigPatch = orderDetails
        ? {
            baseUrl,
            skuInitials: parsedInitials && 'initials' in parsedInitials ? parsedInitials.initials : [],
            alertWebhookUrl,
            sessionCheckTimes: checkTimes,
          }
        : {
            baseUrl,
            catalog,
            accountId,
            placeOrderEnabled,
            alertWebhookUrl,
            sessionCheckTimes: checkTimes,
            skuExcludes: parsedExcludes && 'excludes' in parsedExcludes ? parsedExcludes.excludes : [],
          }
      if (clearCookie) patch.cookie = ''
      else if (cookie.trim()) patch.cookie = cookie
      const res = await updateHHB2bConfig(brand, patch)
      applySaved(res.data)
      setPlaceOrderEnabledContext(orderDetails ? false : Boolean(res.data.placeOrderEnabled))
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

  if (orderDetails) {
    const sessionHost = brandDef.baseUrl.replace(/^https?:\/\//, '')
    const parsedSkuInitials = initialsFromText(skuInitialsText)
    const skuPreviewInitials = 'initials' in parsedSkuInitials ? parsedSkuInitials.initials : []
    return (
      <form
        className="space-y-5 px-5 py-5"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-slate-900 dark:text-[var(--text-100)]">
            {brandDef.name} B2B
          </h2>
          <p className="max-w-2xl text-sm leading-6 text-slate-500 dark:text-[var(--text-200)]">
            Save the portal address and a session cookie from a logged-in browser. Cart drafts are created on
            Thorogood and are not submitted. Place Order stays off.
          </p>
        </div>

        <ConfigSection
          title="Portal"
          description="The signed-in site Ship Queue calls when it drafts a cart."
        >
          <div className="space-y-1.5">
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
              disabled={busy}
            />
            <p className={hintClass}>Envoy portal, e.g. {brandDef.baseUrl}</p>
          </div>
        </ConfigSection>

        <ConfigSection
          title="SKU initials"
          description="Prefixes removed from Seller Central SKUs before the portal search. Footwear is then written as the width, then the size in tenths."
        >
          <div className="space-y-1.5">
            <label className={labelClass} htmlFor="hh-b2b-sku-initials">
              Initials
            </label>
            <p className={hintClass}>One prefix per line. The longest match is removed, including a dash after it.</p>
            <textarea
              id="hh-b2b-sku-initials"
              className={`${inputClass} min-h-[5.5rem] font-mono text-xs`}
              value={skuInitialsText}
              onChange={(event) => setSkuInitialsText(event.target.value)}
              placeholder={'DUP_TG\nDUP-TG\nTG-'}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
            />
            {'error' in parsedSkuInitials ? (
              <p className="text-xs text-red-600 dark:text-red-400">{parsedSkuInitials.error}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <div className="hidden font-mono text-[11px] uppercase tracking-wide text-slate-400 sm:grid sm:grid-cols-2 sm:gap-3 dark:text-[var(--text-200)]">
              <span>Seller Central</span>
              <span>Portal code</span>
            </div>
            <ul className="space-y-1.5">
              {THOROGOOD_SKU_SAMPLES.map((sample) => {
                const portal = thorogoodPortalSku(sample, skuPreviewInitials)
                return (
                  <li
                    key={sample}
                    className="grid grid-cols-1 gap-0.5 font-mono text-xs sm:grid-cols-2 sm:gap-3"
                  >
                    <span className="truncate text-slate-500 dark:text-[var(--text-200)]">{sample}</span>
                    <span className="text-slate-800 dark:text-[var(--text-100)]">{portal || '—'}</span>
                  </li>
                )
              })}
            </ul>
            <p className={hintClass}>10.5 becomes 105. A whole size 10 becomes 100.</p>
          </div>
        </ConfigSection>

        <ConfigSection
          title="Session"
          description="Paste the cookie from a logged-in browser. Check session reads the customer record only."
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${sessionPillClass(saved?.sessionCheck.status ?? null)}`}>
                {sessionLabel(saved?.sessionCheck.status ?? null)}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  saved?.hasCookie
                    ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                    : 'bg-slate-100 text-slate-600 dark:bg-[var(--bg-200)] dark:text-[var(--text-200)]'
                }`}
              >
                {saved?.hasCookie ? 'Cookie stored' : 'No cookie'}
              </span>
            </div>
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
          </div>
          <p className={hintClass}>
            {saved?.sessionCheck.checkedAt
              ? `Last checked ${formatCreatedAt(saved.sessionCheck.checkedAt)}.`
              : 'No check has run yet.'}
            {saved?.hasCookie && saved.cookieUpdatedAt ? ` Cookie updated ${formatCreatedAt(saved.cookieUpdatedAt)}.` : ''}
            {saved?.sessionCheck.latencyMs != null && saved.sessionCheck.status === 'ok'
              ? ` Responded in ${saved.sessionCheck.latencyMs} ms.`
              : ''}
          </p>
          {saved?.sessionCheck.message && saved.sessionCheck.status && saved.sessionCheck.status !== 'ok' ? (
            <p className="text-sm text-red-700 dark:text-red-300">{saved.sessionCheck.message}</p>
          ) : null}
          {checkError ? <p className="text-sm text-red-600 dark:text-red-400">{checkError}</p> : null}
          <div className="space-y-1.5">
            <label className={labelClass} htmlFor="hh-b2b-cookie">
              Session cookie
            </label>
            <p className={hintClass}>
              Paste the Cookie header from a logged-in {sessionHost} tab, including{' '}
              <span className="font-mono">thorogood-prod-na-cf_SESSION</span>. Add{' '}
              <span className="font-mono">XSRF-TOKEN</span> when the browser shows it. The value is not shown again
              after you save.
            </p>
          </div>
          <textarea
            id="hh-b2b-cookie"
            className={`${inputClass} min-h-[7rem] font-mono text-xs`}
            value={cookie}
            onChange={(event) => {
              setCookie(event.target.value)
              if (event.target.value.trim()) setClearCookie(false)
            }}
            placeholder={saved?.hasCookie ? 'Leave blank to keep the stored session' : 'thorogood-prod-na-cf_SESSION=…'}
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
        </ConfigSection>

        <ConfigSection
          title="Alerts"
          description="When the daily check fails, and when the session recovers. Times are Philippines time."
        >
          <div className="space-y-2">
            <span className={labelClass}>Check times</span>
            <p className={hintClass}>{scheduleLabel} Save to apply.</p>
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
          <div className="space-y-1.5">
            <label className={labelClass} htmlFor="hh-b2b-webhook">
              Alert webhook
            </label>
            <input
              id="hh-b2b-webhook"
              className={inputClass}
              value={alertWebhookUrl}
              onChange={(event) => setAlertWebhookUrl(event.target.value)}
              placeholder="https://example.com/hooks/thorogood"
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
            />
            <p className={hintClass}>
              Posted when a check starts failing, and again when the session recovers. Repeat failures stay quiet.
              The body includes <span className="font-mono">event</span>, <span className="font-mono">brand</span>,{' '}
              <span className="font-mono">status</span>, <span className="font-mono">message</span>, and{' '}
              <span className="font-mono">checkedAt</span>. Leave blank to keep the result in this app only.
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
                  ? 'Uses the saved URL. Does not check the session.'
                  : 'Save a webhook URL to send a test.'}
            </span>
            {testNotice ? <span className="text-sm text-emerald-700 dark:text-emerald-300">{testNotice}</span> : null}
            {testError ? <span className="text-sm text-red-600 dark:text-red-400">{testError}</span> : null}
          </div>
        </ConfigSection>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--bg-300)] pt-4 dark:border-[var(--bg-300)]">
          <p
            className={
              saveError
                ? 'text-sm text-red-600 dark:text-red-400'
                : dirty
                  ? 'text-sm font-medium text-slate-700 dark:text-[var(--text-100)]'
                  : saveNotice
                    ? 'text-sm text-emerald-700 dark:text-emerald-300'
                    : hintClass
            }
          >
            {saveError
              ? saveError
              : dirty
                ? 'Unsaved changes'
                : saveNotice
                  ? saveNotice
                  : saved?.updatedAt
                    ? `Saved ${formatCreatedAt(saved.updatedAt)}${saved.updatedByName ? ` by ${saved.updatedByName}` : ''}`
                    : 'No unsaved changes'}
          </p>
          <button
            type="submit"
            disabled={!dirty || busy}
            className="inline-flex cursor-pointer items-center justify-center rounded-lg bg-[var(--accent-200)] px-3.5 py-2 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-[var(--accent-100)] dark:text-[var(--text-100)]"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    )
  }

  const brandLabel = brand === 'workwear' ? 'Work' : 'Sports'
  const sessionHost = brandDef.baseUrl.replace(/^https?:\/\//, '')
  const parsedSkuExcludes = excludesFromText(skuExcludesText)

  return (
    <form
      className="space-y-5 px-5 py-5"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-slate-900 dark:text-[var(--text-100)]">
          B2B {brandLabel} account
        </h2>
        <p className="max-w-2xl text-sm text-slate-500 dark:text-[var(--text-200)]">
          Cart drafts go to this {brandDef.supplier} account. The session is a cookie you paste from a logged-in
          browser. Sphere does not refresh it.
        </p>
      </div>

      <ConfigSection
        title="Account"
        description="Where drafts are sent, and whether Place Order is allowed to submit."
      >
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
          <p className={hintClass}>{brandLabel} portal, e.g. {brandDef.baseUrl}</p>
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
          <p className={hintClass}>{brandDef.catalog} for {brandLabel}. Not the Fashion catalog.</p>
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

        <div className="flex items-start gap-3 border-t border-[var(--bg-300)] pt-4 dark:border-[var(--bg-300)]">
          <div className="min-w-0 flex-1">
            <p className={labelClass}>Place Order</p>
            <p className={`mt-0.5 ${hintClass}`}>
              {placeOrderEnabled
                ? 'On. Place Order re-checks the live cart, then submits matching Ready orders.'
                : 'Off. Place Order still re-checks the live cart, but nothing is submitted.'}
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
      </ConfigSection>

      <ConfigSection
        title="SKU exclusions"
        description="A line stays off the cart when its Seller Central SKU contains one of these."
      >
        <div className="space-y-1.5">
          <label className={labelClass} htmlFor="hh-b2b-sku-excludes">
            Exclusions
          </label>
          <p className={hintClass}>One value per line. DUP_12345 matches DUP_.</p>
          <textarea
            id="hh-b2b-sku-excludes"
            className={`${inputClass} min-h-[5.5rem] font-mono text-xs`}
            value={skuExcludesText}
            onChange={(event) => setSkuExcludesText(event.target.value)}
            placeholder="DUP_"
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
          />
          {'error' in parsedSkuExcludes ? (
            <p className="text-xs text-red-600 dark:text-red-400">{parsedSkuExcludes.error}</p>
          ) : null}
        </div>
      </ConfigSection>

      <ConfigSection
        title="Session"
        description="Paste a cookie from a logged-in browser. Check session reads the catalog only."
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${sessionPillClass(saved?.sessionCheck.status ?? null)}`}>
              {sessionLabel(saved?.sessionCheck.status ?? null)}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                saved?.hasCookie
                  ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                  : 'bg-slate-100 text-slate-600 dark:bg-[var(--bg-200)] dark:text-[var(--text-200)]'
              }`}
            >
              {saved?.hasCookie ? 'Cookie stored' : 'No cookie'}
            </span>
          </div>
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
        </div>
        <p className={hintClass}>
          {saved?.sessionCheck.checkedAt
            ? `Last checked ${formatCreatedAt(saved.sessionCheck.checkedAt)}.`
            : 'No check has run yet.'}
          {saved?.hasCookie && saved.cookieUpdatedAt ? ` Cookie updated ${formatCreatedAt(saved.cookieUpdatedAt)}.` : ''}
          {saved?.sessionCheck.latencyMs != null && saved.sessionCheck.status === 'ok'
            ? ` Responded in ${saved.sessionCheck.latencyMs} ms.`
            : ''}
        </p>
        {saved?.sessionCheck.message && saved.sessionCheck.status && saved.sessionCheck.status !== 'ok' ? (
          <p className="text-sm text-red-700 dark:text-red-300">{saved.sessionCheck.message}</p>
        ) : null}
        {checkError ? <p className="text-sm text-red-600 dark:text-red-400">{checkError}</p> : null}
        <div className="space-y-1.5">
          <label className={labelClass} htmlFor="hh-b2b-cookie">
            Session cookie
          </label>
          <p className={hintClass}>
            Paste the Cookie header from a logged-in {sessionHost} tab. It is not shown again after you save.
          </p>
        </div>
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
      </ConfigSection>

      <ConfigSection
        title="Alerts"
        description="When the daily check fails, and when the session recovers. Times are Philippines time."
      >
        <div className="space-y-2">
          <span className={labelClass}>Check times</span>
          <p className={hintClass}>{scheduleLabel} Save to apply.</p>
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
            Posted when a check starts failing, and again when the session recovers. Repeat failures stay quiet.
            The body includes <span className="font-mono">event</span>, <span className="font-mono">brand</span>,{' '}
            <span className="font-mono">status</span>, <span className="font-mono">message</span>, and{' '}
            <span className="font-mono">checkedAt</span>. Leave blank to keep the result in this app only.
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
                ? 'Uses the saved URL. Does not check the session.'
                : 'Save a webhook URL to send a test.'}
          </span>
          {testNotice ? <span className="text-sm text-emerald-700 dark:text-emerald-300">{testNotice}</span> : null}
          {testError ? <span className="text-sm text-red-600 dark:text-red-400">{testError}</span> : null}
        </div>
      </ConfigSection>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--bg-300)] pt-4 dark:border-[var(--bg-300)]">
        <p
          className={
            saveError
              ? 'text-sm text-red-600 dark:text-red-400'
              : dirty
                ? 'text-sm font-medium text-slate-700 dark:text-[var(--text-100)]'
                : saveNotice
                  ? 'text-sm text-emerald-700 dark:text-emerald-300'
                  : hintClass
          }
        >
          {saveError
            ? saveError
            : dirty
              ? 'Unsaved changes'
              : saveNotice
                ? saveNotice
                : saved?.updatedAt
                  ? `Saved ${formatCreatedAt(saved.updatedAt)}${saved.updatedByName ? ` by ${saved.updatedByName}` : ''}`
                  : 'No unsaved changes'}
        </p>
        <button
          type="submit"
          disabled={!dirty || busy}
          className="inline-flex cursor-pointer items-center justify-center rounded-lg bg-[var(--accent-200)] px-3.5 py-2 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-[var(--accent-100)] dark:text-[var(--text-100)]"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}
