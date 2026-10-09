import { useEffect, useId, useState } from 'react'
import type { ReactNode } from 'react'
import { useAuth } from '../context/AuthContext'
import { formatCreatedAt } from '../lib/hhSportswear'
import { HH_SKU_SAMPLES, hhCartSku, normalizeHhSkuTokens } from '../lib/hhSkuExclude'
import {
  checkBulkOrderSession,
  getBulkOrderCatalogs,
  getBulkOrderConfig,
  getBulkOrderShipTos,
  getBulkOrderSoldTos,
  testBulkOrderWebhook,
  updateBulkOrderConfig,
} from '../lib/bulkOrderConfig'
import type {
  BulkOrderCatalog,
  BulkOrderConfig,
  BulkOrderConfigPatch,
  BulkOrderSessionCheck,
  BulkOrderShipTo,
  BulkOrderSoldTo,
} from '../lib/bulkOrderConfig'

const inputClass =
  'w-full rounded-lg border border-[var(--bg-300)] bg-[var(--bg-100)] px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--accent-200)] disabled:cursor-default disabled:opacity-80 dark:border-[var(--bg-300)] dark:bg-[var(--bg-200)] dark:text-[var(--text-100)]'

const labelClass = 'block text-sm font-medium text-slate-700 dark:text-[var(--text-100)]'
const hintClass = 'block text-xs text-slate-500 dark:text-[var(--text-200)]'
const quietButtonClass =
  'inline-flex cursor-pointer items-center justify-center rounded-lg border border-[var(--bg-300)] bg-[var(--bg-100)] px-3.5 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-[var(--primary-100)] disabled:cursor-not-allowed disabled:opacity-40 dark:border-[var(--bg-300)] dark:text-[var(--text-100)] dark:hover:bg-[var(--primary-100)]'

const MAX_CHECK_TIMES = 12

type ConfigSectionId = 'account' | 'sku' | 'session' | 'alerts'

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

function sessionLabel(status: BulkOrderSessionCheck['status']): string {
  if (status === 'ok') return 'Working'
  if (status === 'auth') return 'Needs a new cookie'
  if (status === 'down') return 'Not responding'
  return 'Not checked yet'
}

function cookieSourceOf(data: BulkOrderConfig | null): BulkOrderConfig['cookieSource'] {
  if (!data) return 'none'
  return data.cookieSource
}

function sessionNeedsAttention(data: BulkOrderConfig): boolean {
  const source = cookieSourceOf(data)
  if (source === 'none' || source === 'jar-empty') return true
  return data.sessionCheck.status === 'auth' || data.sessionCheck.status === 'down'
}

function sessionSummary(data: BulkOrderConfig | null): string {
  const source = cookieSourceOf(data)
  const failed = data?.sessionCheck.status === 'auth' || data?.sessionCheck.status === 'down'
  if (source === 'none' || source === 'jar-empty') {
    if (failed && data) return sessionLabel(data.sessionCheck.status)
    return source === 'jar-empty' ? 'Cookie Jar empty' : 'No cookie'
  }
  if (source === 'config' && data?.cookieUpdatedAt) {
    return `${sessionLabel(data.sessionCheck.status)} · Cookie updated ${formatCreatedAt(data.cookieUpdatedAt)}`
  }
  const sourceLabel = source === 'jar' ? 'Cookie Jar' : source === 'env' ? 'Server cookie' : 'Cookie stored'
  return `${sessionLabel(data?.sessionCheck.status ?? null)} · ${sourceLabel}`
}

function cookieBadge(data: BulkOrderConfig | null): { label: string; className: string } {
  const ready = 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
  const missing = 'bg-slate-100 text-slate-600 dark:bg-[var(--bg-200)] dark:text-[var(--text-200)]'
  const source = cookieSourceOf(data)
  if (source === 'jar') return { label: 'Cookie Jar', className: ready }
  if (source === 'env') return { label: 'Server cookie', className: ready }
  if (source === 'config') return { label: 'Cookie stored', className: ready }
  if (source === 'jar-empty') return { label: 'Cookie Jar empty', className: missing }
  return { label: 'No cookie', className: missing }
}

function sessionPillClass(status: BulkOrderSessionCheck['status']): string {
  if (status === 'ok') return 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
  if (status === 'auth' || status === 'down') return 'bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300'
  return 'bg-slate-100 text-slate-600 dark:bg-[var(--bg-200)] dark:text-[var(--text-200)]'
}

function cookieFieldPlaceholder(data: BulkOrderConfig | null): string {
  if (data?.hasCookie) return 'Leave blank to keep the stored session'
  const source = cookieSourceOf(data)
  if (source === 'jar' || source === 'jar-empty') return 'Paste to override Cookie Jar'
  if (source === 'env') return 'Paste to override the server session'
  return 'thorogood-prod-na-cf_SESSION=…'
}

function accountSummary(catalogValue: string, accountValue: string, shipToCode: string, enabled: boolean): string {
  const catalogLabel = catalogValue.trim() || 'No catalog'
  const accountLabel = accountValue.trim() || 'No account'
  const shipLabel = shipToCode.trim() || 'No ship to'
  return `${catalogLabel} · ${accountLabel} · ${shipLabel} · Place Order ${enabled ? 'on' : 'off'}`
}

function countPhrase(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`
}

function skuStringsSummary(start: number, end: number): string {
  if (start === 0 && end === 0) return 'None'
  return `${countPhrase(start, 'start string', 'start strings')}, ${countPhrase(end, 'end string', 'end strings')}`
}

function manilaMinutesNow(): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date())
  let hour = Number(parts.find((part) => part.type === 'hour')?.value)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 0
  if (hour === 24) hour = 0
  return hour * 60 + minute
}

function alertsSummary(times: string[]): string {
  const slots = times
    .map((time) => {
      const [hourRaw, minuteRaw] = time.split(':')
      const hour = Number(hourRaw)
      const minute = Number(minuteRaw)
      if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
      return { time, at: hour * 60 + minute }
    })
    .filter((slot): slot is { time: string; at: number } => slot != null)
    .sort((left, right) => left.at - right.at)
  if (slots.length === 0) return 'No daily check'
  const now = manilaMinutesNow()
  const upcoming = slots.find((slot) => slot.at > now) ?? slots[0]
  return `Next check ${formatCheckClock(upcoming.time)}`
}

function tokensFromText(text: string, label: string): { tokens: string[] } | { error: string } {
  return normalizeHhSkuTokens(text.split(/\r?\n/), label)
}

function sameTokens(text: string, saved: string[], label: string): boolean {
  const parsed = tokensFromText(text, label)
  if ('error' in parsed) return false
  if (parsed.tokens.length !== saved.length) return false
  return parsed.tokens.every((token, index) => token === saved[index])
}

function sameCheckTimes(current: string[], saved: string[]): boolean {
  if (current.length !== saved.length) return false
  return current.every((time, index) => time === saved[index])
}

function ConfigChoice({
  id,
  value,
  options,
  onChange,
  disabled,
}: {
  id: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const known = options.some((option) => option.value === value)
  const choices = known || !value ? options : [{ value, label: value }, ...options]
  return (
    <select
      id={id}
      className={`${inputClass} cursor-pointer`}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
    >
      {choices.map((option) => (
        <option key={`${option.value}-${option.label}`} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

function ConfigSection({
  title,
  description,
  summary,
  open,
  dirty,
  error,
  attention,
  canEdit,
  onToggle,
  children,
}: {
  title: string
  description: string
  summary: string
  open: boolean
  dirty: boolean
  error?: string | null
  attention?: boolean
  canEdit: boolean
  onToggle: () => void
  children: ReactNode
}) {
  const panelId = useId()
  const summaryText = error || summary
  const summaryAlert = Boolean(error) || Boolean(attention)
  const staysOpen = open && (dirty || Boolean(error))
  const motionClass = 'duration-[240ms] ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none'

  return (
    <section
      className={`overflow-hidden rounded-xl border transition-colors ${motionClass} ${
        open ? 'bg-[color-mix(in_srgb,var(--accent-200)_14%,var(--bg-100))]' : 'bg-[var(--bg-200)]/30'
      } ${error ? 'border-red-300 dark:border-red-900/60' : open ? 'border-[var(--accent-200)]' : 'border-[var(--bg-300)]'}`}
    >
      <h3 className="m-0">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panelId}
          title={staysOpen ? 'Save changes before closing this section.' : undefined}
          className={`flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent-200)] ${motionClass} ${
            open ? '' : 'hover:bg-[var(--bg-200)]/80'
          }`}
        >
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-slate-900 dark:text-[var(--text-100)]">{title}</span>
              {dirty ? (
                <span className="inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-[var(--bg-300)] dark:text-[var(--text-200)]">
                  Unsaved
                </span>
              ) : null}
            </span>
            <span
              className={`grid transition-[grid-template-rows] ${motionClass} ${open ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'}`}
              aria-hidden={open}
            >
              <span className="min-h-0 overflow-hidden">
                <span
                  className={`mt-0.5 block truncate text-xs ${
                    summaryAlert ? 'text-red-700 dark:text-red-300' : 'text-slate-500 dark:text-[var(--text-200)]'
                  }`}
                >
                  {summaryText}
                </span>
              </span>
            </span>
          </span>
          <svg
            className={`h-4 w-4 shrink-0 text-slate-400 transition-transform dark:text-[var(--text-200)] ${motionClass} ${
              open ? 'rotate-180' : ''
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </h3>
      <div
        id={panelId}
        className={`grid transition-[grid-template-rows] ${motionClass} ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
        inert={!open}
        aria-hidden={open ? undefined : true}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            className={`border-t border-[var(--bg-300)] px-4 py-4 transition-opacity ${motionClass} ${
              open ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <p className="mb-4 text-xs leading-5 text-slate-500 dark:text-[var(--text-200)]">{description}</p>
            <fieldset disabled={!canEdit} className="m-0 min-w-0 space-y-4 border-0 p-0">
              {children}
            </fieldset>
          </div>
        </div>
      </div>
    </section>
  )
}

export default function BulkOrderConfig() {
  const { user } = useAuth()
  const canEdit = user?.role === 'admin'
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saved, setSaved] = useState<BulkOrderConfig | null>(null)
  const [baseUrl, setBaseUrl] = useState('')
  const [catalog, setCatalog] = useState('')
  const [accountId, setAccountId] = useState('')
  const [defaultShipToCode, setDefaultShipToCode] = useState('')
  const [dropShipName, setDropShipName] = useState('')
  const [dropShipAddress, setDropShipAddress] = useState('')
  const [dropShipPostalCode, setDropShipPostalCode] = useState('')
  const [soldToOptions, setSoldToOptions] = useState<BulkOrderSoldTo[]>([])
  const [catalogOptions, setCatalogOptions] = useState<BulkOrderCatalog[]>([])
  const [shipToOptions, setShipToOptions] = useState<BulkOrderShipTo[]>([])
  const [soldToNote, setSoldToNote] = useState<string | null>(null)
  const [catalogNote, setCatalogNote] = useState<string | null>(null)
  const [shipToNote, setShipToNote] = useState<string | null>(null)
  const [cookie, setCookie] = useState('')
  const [skuPrefixesText, setSkuPrefixesText] = useState('')
  const [skuSuffixesText, setSkuSuffixesText] = useState('')
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
  const [openIds, setOpenIds] = useState<ConfigSectionId[]>([])

  const applySaved = (data: BulkOrderConfig) => {
    setSaved(data)
    setBaseUrl(data.baseUrl)
    setCatalog(data.catalog)
    setAccountId(data.accountId)
    setDefaultShipToCode(data.defaultShipToCode)
    setDropShipName(data.dropShipName)
    setDropShipAddress(data.dropShipAddress)
    setDropShipPostalCode(data.dropShipPostalCode)
    setSkuPrefixesText((data.skuPrefixes ?? []).join('\n'))
    setSkuSuffixesText((data.skuSuffixes ?? []).join('\n'))
    setPlaceOrderEnabled(Boolean(data.placeOrderEnabled))
    setAlertWebhookUrl(data.alertWebhookUrl || '')
    setCheckTimes(data.sessionCheckTimes?.length ? data.sessionCheckTimes : [])
    setCookie('')
    setClearCookie(false)
  }

  useEffect(() => {
    let cancelled = false
    getBulkOrderConfig()
      .then((res) => {
        if (cancelled) return
        applySaved(res.data)
        setOpenIds(sessionNeedsAttention(res.data) ? ['session'] : [])
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
  }, [])

  useEffect(() => {
    if (loadState !== 'ready') return
    let cancelled = false
    getBulkOrderSoldTos()
      .then((res) => {
        if (cancelled) return
        setSoldToOptions(res.data)
        setSoldToNote(res.source === 'fallback' ? res.message || 'Showing 23550 - OUTDOOR EQUIPPED only.' : null)
      })
      .catch(() => {
        if (cancelled) return
        setSoldToNote('Could not load customers. Showing the saved account only.')
      })
    getBulkOrderCatalogs()
      .then((res) => {
        if (cancelled) return
        setCatalogOptions(res.data)
        setCatalogNote(res.source === 'fallback' ? res.message || 'Showing Thorogood Boots only.' : null)
      })
      .catch(() => {
        if (cancelled) return
        setCatalogNote('Could not load catalogs. Showing the saved catalog only.')
      })
    return () => {
      cancelled = true
    }
  }, [loadState])

  useEffect(() => {
    if (loadState !== 'ready') return
    const customer = accountId.trim()
    if (!/^\d{4,}$/.test(customer)) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      getBulkOrderShipTos(customer)
        .then((res) => {
          if (cancelled) return
          const options = res.data
          setShipToOptions(options)
          setShipToNote(res.source === 'fallback' ? res.message || 'Showing the warehouse address only.' : null)
          setDefaultShipToCode((current) => {
            if (options.some((option) => option.code === current)) return current
            if (accountId === saved?.accountId) return current
            return (options.find((option) => option.code === 'NCWH') ?? options[0])?.code ?? current
          })
        })
        .catch(() => {
          if (cancelled) return
          setShipToNote('Could not load ship-to addresses. Showing the saved ship to only.')
        })
    }, 300)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [loadState, accountId, saved?.accountId])

  const savedTimes = saved?.sessionCheckTimes ?? []
  const prefixesParsed = tokensFromText(skuPrefixesText, 'Start strings')
  const suffixesParsed = tokensFromText(skuSuffixesText, 'End strings')
  const skuError =
    'error' in prefixesParsed ? prefixesParsed.error : 'error' in suffixesParsed ? suffixesParsed.error : null
  const accountDirty = Boolean(
    saved &&
      (baseUrl !== saved.baseUrl ||
        catalog !== saved.catalog ||
        accountId !== saved.accountId ||
        defaultShipToCode !== saved.defaultShipToCode ||
        dropShipName !== saved.dropShipName ||
        dropShipAddress !== saved.dropShipAddress ||
        dropShipPostalCode !== saved.dropShipPostalCode ||
        placeOrderEnabled !== Boolean(saved.placeOrderEnabled)),
  )
  const skuDirty = Boolean(
    saved &&
      (!sameTokens(skuPrefixesText, saved.skuPrefixes ?? [], 'Start strings') ||
        !sameTokens(skuSuffixesText, saved.skuSuffixes ?? [], 'End strings')),
  )
  const sessionDirty = canEdit && (cookie.trim().length > 0 || clearCookie)
  const alertsDirty = Boolean(
    canEdit && saved && (alertWebhookUrl !== (saved.alertWebhookUrl || '') || !sameCheckTimes(checkTimes, savedTimes)),
  )
  const dirty = canEdit && saved != null && (accountDirty || skuDirty || sessionDirty || alertsDirty)

  const sectionLocked = (id: ConfigSectionId) => {
    if (id === 'account') return accountDirty
    if (id === 'sku') return skuDirty || Boolean(skuError)
    if (id === 'session') return sessionDirty
    return alertsDirty
  }

  const toggleSection = (id: ConfigSectionId) => {
    setOpenIds((current) => {
      if (current.includes(id)) {
        if (sectionLocked(id)) return current
        return current.filter((key) => key !== id)
      }
      return [...current.filter((key) => sectionLocked(key)), id]
    })
  }

  const revealSection = (id: ConfigSectionId) => {
    setOpenIds((current) => {
      const kept = current.filter((key) => sectionLocked(key))
      return kept.includes(id) ? kept : [...kept, id]
    })
  }

  const isOpen = (id: ConfigSectionId) => openIds.includes(id)

  const checkSession = async () => {
    if (!canEdit || checking) return
    setChecking(true)
    setCheckError(null)
    try {
      const res = await checkBulkOrderSession()
      setSaved((current) =>
        current
          ? {
              ...current,
              hasCookie: res.data.hasCookie,
              cookieSource: res.data.cookieSource,
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
    if (!canEdit || testingWebhook) return
    setTestingWebhook(true)
    setTestError(null)
    setTestNotice(null)
    try {
      const res = await testBulkOrderWebhook()
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
    if (!canEdit || busy || !dirty) return
    setBusy(true)
    setSaveError(null)
    setSaveNotice(null)
    setTestError(null)
    setTestNotice(null)
    const parsedPrefixes = tokensFromText(skuPrefixesText, 'Start strings')
    if ('error' in parsedPrefixes) {
      setSaveError(parsedPrefixes.error)
      revealSection('sku')
      setBusy(false)
      return
    }
    const parsedSuffixes = tokensFromText(skuSuffixesText, 'End strings')
    if ('error' in parsedSuffixes) {
      setSaveError(parsedSuffixes.error)
      revealSection('sku')
      setBusy(false)
      return
    }
    const patch: BulkOrderConfigPatch = {
      baseUrl,
      catalog,
      accountId,
      defaultShipToCode,
      dropShipName,
      dropShipAddress,
      dropShipPostalCode,
      placeOrderEnabled,
      alertWebhookUrl,
      sessionCheckTimes: checkTimes,
      skuPrefixes: parsedPrefixes.tokens,
      skuSuffixes: parsedSuffixes.tokens,
    }
    if (clearCookie) patch.cookie = ''
    else if (cookie.trim()) patch.cookie = cookie
    try {
      const res = await updateBulkOrderConfig(patch)
      applySaved(res.data)
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
  const skuPreviewPrefixes = 'tokens' in prefixesParsed ? prefixesParsed.tokens : []
  const skuPreviewSuffixes = 'tokens' in suffixesParsed ? suffixesParsed.tokens : []

  if (loadState === 'loading') {
    return <p className="px-5 py-8 text-sm text-slate-500 dark:text-[var(--text-200)]">Loading configurations…</p>
  }

  if (loadState === 'error') {
    return <p className="px-5 py-8 text-sm text-red-600 dark:text-red-400">{loadError}</p>
  }

  return (
    <form
      className="space-y-5 px-5 py-5"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold text-slate-900 dark:text-[var(--text-100)]">Thorogood bulk account</h2>
          {canEdit ? null : (
            <span className="inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-[var(--bg-300)] dark:text-[var(--text-200)]">
              Read-only
            </span>
          )}
        </div>
        <p className="max-w-2xl text-sm text-slate-500 dark:text-[var(--text-200)]">
          Bulk orders use this Thorogood account. Cookie Jar refreshes the thorogood-b2b session from Sphere. A cookie pasted below overrides that session.
        </p>
      </div>

      <div className="space-y-3">
        <ConfigSection
          title="Account"
          description="Defaults for Create Order, and whether Place Order is allowed to submit."
          summary={accountSummary(catalog, accountId, defaultShipToCode, placeOrderEnabled)}
          open={isOpen('account')}
          dirty={accountDirty}
          canEdit={canEdit}
          onToggle={() => toggleSection('account')}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <label className={labelClass} htmlFor="bulk-b2b-base-url">
                Base URL
              </label>
              <input
                id="bulk-b2b-base-url"
                className={inputClass}
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                disabled={busy}
              />
              <p className={hintClass}>Thorogood portal, e.g. https://thorogood.thorogoodb2b.com</p>
            </div>
            <div className="space-y-1.5">
              <label className={labelClass} htmlFor="bulk-b2b-account-id">
                Sold To
              </label>
              <ConfigChoice
                id="bulk-b2b-account-id"
                value={accountId}
                options={soldToOptions.map((option) => ({ value: option.code, label: option.label }))}
                onChange={setAccountId}
                disabled={busy}
              />
              <p className={hintClass}>Default customer on Create Order.</p>
              {soldToNote ? <p className={hintClass}>{soldToNote}</p> : null}
            </div>
            <div className="space-y-1.5">
              <label className={labelClass} htmlFor="bulk-b2b-catalog">
                Catalog
              </label>
              <ConfigChoice
                id="bulk-b2b-catalog"
                value={catalog}
                options={catalogOptions.map((option) => ({ value: option.name, label: option.name }))}
                onChange={setCatalog}
                disabled={busy}
              />
              <p className={hintClass}>Default catalog on each shipment.</p>
              {catalogNote ? <p className={hintClass}>{catalogNote}</p> : null}
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <label className={labelClass} htmlFor="bulk-b2b-ship-to">
                Ship To
              </label>
              <ConfigChoice
                id="bulk-b2b-ship-to"
                value={defaultShipToCode}
                options={shipToOptions.map((option) => ({ value: option.code, label: option.label }))}
                onChange={setDefaultShipToCode}
                disabled={busy}
              />
              <p className={hintClass}>Default ship to on the order and on each shipment.</p>
              {shipToNote ? <p className={hintClass}>{shipToNote}</p> : null}
            </div>
            <div className="space-y-3 border-t border-[var(--bg-300)] pt-4 sm:col-span-2">
              <div>
                <p className={labelClass}>Drop Ship Address</p>
                <p className={hintClass}>Default name, address, and zip on each shipment.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-9">
                <div className="space-y-1.5 sm:col-span-3">
                  <label className={labelClass} htmlFor="bulk-b2b-drop-name">
                    Name
                  </label>
                  <input
                    id="bulk-b2b-drop-name"
                    className={inputClass}
                    value={dropShipName}
                    onChange={(event) => setDropShipName(event.target.value)}
                    autoComplete="off"
                    disabled={busy}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-4">
                  <label className={labelClass} htmlFor="bulk-b2b-drop-address">
                    Address
                  </label>
                  <input
                    id="bulk-b2b-drop-address"
                    className={inputClass}
                    value={dropShipAddress}
                    onChange={(event) => setDropShipAddress(event.target.value)}
                    autoComplete="off"
                    disabled={busy}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <label className={labelClass} htmlFor="bulk-b2b-drop-postal">
                    Zip / Postal Code
                  </label>
                  <input
                    id="bulk-b2b-drop-postal"
                    className={inputClass}
                    value={dropShipPostalCode}
                    onChange={(event) => setDropShipPostalCode(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={busy}
                  />
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-start gap-3 border-t border-[var(--bg-300)] pt-4 dark:border-[var(--bg-300)]">
            <div className="min-w-0 flex-1">
              <p className={labelClass}>Place Order</p>
              <p className={`mt-0.5 ${hintClass}`}>
                {placeOrderEnabled ? 'On. Place Order is allowed to submit.' : 'Off. Place Order does not submit.'}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={placeOrderEnabled}
              aria-label="Place Order enabled"
              disabled={busy || !canEdit}
              onClick={() => setPlaceOrderEnabled((current) => !current)}
              className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                busy || !canEdit ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
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
          title="SKU strings"
          description="Removed from the Seller Central SKU before it is added to the cart and before verification. The line still ships. Start strings are only removed from the front, and end strings only from the back. Matching ignores case, so dup_ and DUP_ are the same string."
          summary={skuStringsSummary(
            'tokens' in prefixesParsed ? prefixesParsed.tokens.length : 0,
            'tokens' in suffixesParsed ? suffixesParsed.tokens.length : 0,
          )}
          open={isOpen('sku')}
          dirty={skuDirty}
          error={skuError}
          canEdit={canEdit}
          onToggle={() => toggleSection('sku')}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className={labelClass} htmlFor="bulk-b2b-sku-prefixes">
                Start of SKU
              </label>
              <p className={hintClass}>One value per line. DUP_70429_482-M becomes 70429_482-M.</p>
              <textarea
                id="bulk-b2b-sku-prefixes"
                className={`${inputClass} min-h-[5.5rem] font-mono text-xs`}
                value={skuPrefixesText}
                onChange={(event) => setSkuPrefixesText(event.target.value)}
                placeholder={'DUP_\nDUP-'}
                autoComplete="off"
                spellCheck={false}
                disabled={busy}
              />
              {'error' in prefixesParsed ? (
                <p className="text-xs text-red-600 dark:text-red-400">{prefixesParsed.error}</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <label className={labelClass} htmlFor="bulk-b2b-sku-suffixes">
                End of SKU
              </label>
              <p className={hintClass}>One value per line. 70429_482-M_fba becomes 70429_482-M.</p>
              <textarea
                id="bulk-b2b-sku-suffixes"
                className={`${inputClass} min-h-[5.5rem] font-mono text-xs`}
                value={skuSuffixesText}
                onChange={(event) => setSkuSuffixesText(event.target.value)}
                placeholder={'_fba\n-fba'}
                autoComplete="off"
                spellCheck={false}
                disabled={busy}
              />
              {'error' in suffixesParsed ? (
                <p className="text-xs text-red-600 dark:text-red-400">{suffixesParsed.error}</p>
              ) : null}
            </div>
          </div>
          <div className="space-y-2">
            <div className="hidden font-mono text-[11px] uppercase tracking-wide text-slate-400 sm:grid sm:grid-cols-2 sm:gap-3 dark:text-[var(--text-200)]">
              <span>Seller Central</span>
              <span>Cart SKU</span>
            </div>
            <ul className="space-y-1.5">
              {HH_SKU_SAMPLES.map((sample) => (
                <li key={sample} className="grid grid-cols-1 gap-0.5 font-mono text-xs sm:grid-cols-2 sm:gap-3">
                  <span className="truncate text-slate-500 dark:text-[var(--text-200)]">{sample}</span>
                  <span className="text-slate-800 dark:text-[var(--text-100)]">
                    {hhCartSku(sample, skuPreviewPrefixes, skuPreviewSuffixes) || '—'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </ConfigSection>

        <ConfigSection
          title="Session"
          description="Cookie Jar refreshes this from Sphere. A cookie pasted here overrides that session. Check session reads the customer record only."
          summary={sessionSummary(saved)}
          open={isOpen('session')}
          dirty={sessionDirty}
          attention={saved ? sessionNeedsAttention(saved) : false}
          canEdit={canEdit}
          onToggle={() => toggleSection('session')}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${sessionPillClass(saved?.sessionCheck.status ?? null)}`}>
                {sessionLabel(saved?.sessionCheck.status ?? null)}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cookieBadge(saved).className}`}>
                {cookieBadge(saved).label}
              </span>
            </div>
            <button type="button" disabled={checking || busy} onClick={() => void checkSession()} className={quietButtonClass}>
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
            <label className={labelClass} htmlFor="bulk-b2b-cookie">
              Session cookie
            </label>
            <p className={hintClass}>
              Optional. Paste the Cookie header from a logged-in thorogood.thorogoodb2b.com tab to override the{' '}
              <span className="font-mono">thorogood-b2b</span> Cookie Jar, including{' '}
              <span className="font-mono">thorogood-prod-na-cf_SESSION</span>. Add{' '}
              <span className="font-mono">XSRF-TOKEN</span> when the browser shows it. The value is not shown again
              after you save.
            </p>
          </div>
          <textarea
            id="bulk-b2b-cookie"
            className={`${inputClass} min-h-[7rem] font-mono text-xs`}
            value={cookie}
            onChange={(event) => {
              setCookie(event.target.value)
              if (event.target.value.trim()) setClearCookie(false)
            }}
            placeholder={cookieFieldPlaceholder(saved)}
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
          summary={alertsSummary(checkTimes)}
          open={isOpen('alerts')}
          dirty={alertsDirty}
          canEdit={canEdit}
          onToggle={() => toggleSection('alerts')}
        >
          <div className="space-y-2">
            <span className={labelClass}>Check times</span>
            <p className={hintClass}>{scheduleLabel} Save to apply.</p>
            {checkTimes.length > 0 ? (
              <ul className="space-y-2">
                {checkTimes.map((time, index) => (
                  <li key={`${time}-${index}`} className="flex items-center gap-2">
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
            <label className={labelClass} htmlFor="bulk-b2b-webhook">
              Alert webhook
            </label>
            <input
              id="bulk-b2b-webhook"
              className={inputClass}
              value={alertWebhookUrl}
              onChange={(event) => setAlertWebhookUrl(event.target.value)}
              placeholder="https://example.com/hooks/bulk-thorogood"
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
              onClick={() => void sendWebhookTest()}
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
      </div>

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
        {canEdit ? (
          <button
            type="submit"
            disabled={!dirty || busy}
            className="inline-flex cursor-pointer items-center justify-center rounded-lg bg-[var(--accent-200)] px-3.5 py-2 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-[var(--accent-100)] dark:text-[var(--text-100)]"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        ) : (
          <p className={hintClass}>Only an admin can change these settings.</p>
        )}
      </div>
    </form>
  )
}
