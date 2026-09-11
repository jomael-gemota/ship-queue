import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_HINTS,
  DOCUMENT_TYPE_ICONS,
  DOCUMENT_TYPE_LABELS,
  documentTypeOf,
  type DocTidyRuleInput,
  type DocumentType,
  type MatchMode,
} from '../../types/docTidy'
import { RuleCriteria, Spinner, ToggleSwitch } from './docTidyUi'

const inputClass =
  'w-full text-sm border border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-200)] text-gray-900 dark:text-[var(--text-100)] rounded-lg px-3 py-2 placeholder:text-[var(--text-200)]/70 focus:outline-none focus:ring-2 focus:ring-[var(--accent-200)] focus:border-transparent transition-shadow'

const errorInputClass =
  'border-rose-400 dark:border-rose-500 focus:ring-rose-400 dark:focus:ring-rose-500'

/**
 * A collapsible group of related controls. Collapsed, the header trades the
 * section's description for a summary of what it currently holds, so the form
 * can be reviewed end to end without expanding anything.
 */
function Section({
  step,
  title,
  description,
  summary,
  open,
  invalid,
  onToggle,
  children,
}: {
  step: number
  title: string
  description: string
  summary: string
  open: boolean
  invalid: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  const panelId = `rule-section-${step}`

  return (
    <section
      className={`overflow-hidden rounded-xl border transition-colors ${
        invalid ? 'border-rose-300 dark:border-rose-500/50' : 'border-[var(--bg-300)]'
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors cursor-pointer ${
          open ? 'bg-[var(--bg-200)]' : 'hover:bg-[var(--bg-200)]/60'
        }`}
      >
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold transition-colors ${
            invalid
              ? 'bg-rose-500 text-white'
              : open
                ? 'bg-[var(--accent-200)] text-white'
                : 'bg-[var(--bg-300)] text-[var(--text-200)]'
          }`}
        >
          {step}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-[var(--text-100)]">{title}</span>
          <span
            className={`block truncate text-xs ${
              invalid ? 'text-rose-600 dark:text-rose-400' : 'text-[var(--text-200)]'
            }`}
          >
            {open ? description : summary}
          </span>
        </span>

        <svg
          className={`h-4 w-4 shrink-0 text-[var(--text-200)] transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div id={panelId} className="space-y-4 border-t border-[var(--bg-300)] px-4 py-4">
          {children}
        </div>
      )}
    </section>
  )
}

function FieldLabel({
  htmlFor,
  label,
  hint,
  required = false,
}: {
  htmlFor?: string
  label: string
  hint?: string
  required?: boolean
}) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-medium text-[var(--text-100)]">
      {label}
      {required && <span className="ml-0.5 text-rose-500">*</span>}
      {hint && <span className="ml-1.5 text-xs font-normal text-[var(--text-200)]">{hint}</span>}
    </label>
  )
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return <p className="text-xs text-rose-600 dark:text-rose-400">{message}</p>
}

/** Compact pill group for a small, mutually exclusive choice. */
function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (next: T) => void
  ariaLabel: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex rounded-lg border border-[var(--bg-300)] bg-[var(--bg-200)] p-0.5"
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={`rounded-[6px] px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer ${
              active
                ? 'bg-[var(--bg-100)] text-[var(--text-100)] shadow-sm'
                : 'text-[var(--text-200)] hover:text-[var(--text-100)]'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/** The document type choice, as selectable cards rather than a dropdown. */
function DocumentTypePicker({
  value,
  onChange,
}: {
  value: DocumentType
  onChange: (next: DocumentType) => void
}) {
  return (
    <div role="radiogroup" aria-label="Document type" className="grid gap-2 sm:grid-cols-3">
      {DOCUMENT_TYPES.map((type) => {
        const active = type === value
        return (
          <button
            key={type}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(type)}
            className={`flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors cursor-pointer ${
              active
                ? 'border-[var(--accent-200)] bg-[var(--primary-100)] ring-1 ring-[var(--accent-200)]'
                : 'border-[var(--bg-300)] hover:bg-[var(--bg-200)]'
            }`}
          >
            <span className="flex items-center gap-2 text-sm font-medium text-[var(--text-100)]">
              <svg
                className={`h-4 w-4 shrink-0 ${active ? 'text-[var(--accent-200)]' : 'text-[var(--text-200)]'}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d={DOCUMENT_TYPE_ICONS[type]}
                />
              </svg>
              {DOCUMENT_TYPE_LABELS[type]}
            </span>
            <span className="text-xs text-[var(--text-200)]">{DOCUMENT_TYPE_HINTS[type]}</span>
          </button>
        )
      })}
    </div>
  )
}

/** Repeatable free-text entry rendered as removable chips. */
function ChipInput({
  label,
  hint,
  values,
  onChange,
  placeholder,
}: {
  label: string
  hint?: string
  values: string[]
  onChange: (next: string[]) => void
  placeholder: string
}) {
  const [draft, setDraft] = useState('')
  const id = useId()

  const commit = () => {
    const parts = draft
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
    if (!parts.length) return
    // Case-insensitive de-dupe so the same term isn't added twice.
    const existing = new Set(values.map((v) => v.toLowerCase()))
    onChange([...values, ...parts.filter((p) => !existing.has(p.toLowerCase()))])
    setDraft('')
  }

  return (
    <div className="space-y-1.5">
      <FieldLabel htmlFor={id} label={label} hint={hint} />

      <input
        id={id}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            commit()
            return
          }
          // Backspace on an empty box removes the last chip, as in a mail client.
          if (e.key === 'Backspace' && !draft && values.length) {
            onChange(values.slice(0, -1))
          }
        }}
        // Commit on blur too, so a typed term isn't silently lost on save.
        onBlur={commit}
        placeholder={placeholder}
        className={inputClass}
      />

      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {values.map((value, i) => (
            <span
              key={`${value}-${i}`}
              className="inline-flex items-center gap-1 rounded-full bg-[var(--primary-100)] py-1 pl-2.5 pr-1.5 text-xs font-medium text-[var(--accent-200)]"
            >
              {value}
              <button
                type="button"
                onClick={() => onChange(values.filter((_, idx) => idx !== i))}
                className="inline-flex h-4 w-4 items-center justify-center rounded-full opacity-60 hover:bg-[var(--accent-200)]/15 hover:opacity-100 cursor-pointer"
                aria-label={`Remove ${value}`}
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

type Errors = { name?: string; lookback?: string; dates?: string }

type SectionId = 'basics' | 'senders' | 'keywords' | 'timeframe' | 'attachments'

/** Only Basics starts open; the rest are filled in as the user works down. */
const INITIAL_SECTIONS: Record<SectionId, boolean> = {
  basics: true,
  senders: false,
  keywords: false,
  timeframe: false,
  attachments: false,
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/** One line describing what a collapsed section currently holds. */
const SECTION_SUMMARY: Record<SectionId, (rule: DocTidyRuleInput) => string> = {
  basics: (rule) =>
    [
      rule.name.trim() || 'Untitled rule',
      DOCUMENT_TYPE_LABELS[documentTypeOf(rule.documentType)],
      rule.enabled ? 'Enabled' : 'Disabled',
    ].join(' · '),

  senders: (rule) => {
    const parts: string[] = []
    if (rule.fromAddresses.length) parts.push(`From ${plural(rule.fromAddresses.length, 'address')}`)
    if (rule.toAddresses.length) parts.push(`To ${plural(rule.toAddresses.length, 'address')}`)
    return parts.length ? parts.join(' · ') : 'Any sender or recipient'
  },

  keywords: (rule) => {
    const terms = rule.subjectKeywords.length + rule.bodyKeywords.length
    if (!terms && !rule.excludeKeywords.length) return 'No keyword conditions'

    const parts: string[] = []
    if (terms) {
      parts.push(plural(terms, 'keyword'))
      parts.push(rule.matchMode === 'all' ? 'all must match' : 'any may match')
    }
    if (rule.excludeKeywords.length) parts.push(plural(rule.excludeKeywords.length, 'exclusion'))
    return parts.join(' · ')
  },

  timeframe: (rule) => {
    if (rule.lookbackDays) return `Last ${rule.lookbackDays} days`
    if (rule.dateFrom || rule.dateTo) {
      const from = rule.dateFrom ? String(rule.dateFrom).slice(0, 10) : 'any'
      const to = rule.dateTo ? String(rule.dateTo).slice(0, 10) : 'today'
      return `${from} → ${to}`
    }
    return 'Any date'
  },

  attachments: (rule) =>
    [
      rule.requireAttachment ? 'Attachment required' : 'Attachment optional',
      rule.attachmentExtensions.length
        ? rule.attachmentExtensions.map((ext) => `.${ext}`).join(' ')
        : 'any file type',
    ].join(' · '),
}

/**
 * Create/edit form for an extraction rule. Grouped into sections that mirror the
 * order a message is tested in: who sent it, what it says, when it arrived and
 * what it carries.
 */
export default function RuleEditor({
  initial,
  isNew,
  saving,
  onCancel,
  onSave,
}: {
  initial: DocTidyRuleInput
  isNew: boolean
  saving: boolean
  onCancel: () => void
  onSave: (rule: DocTidyRuleInput) => void
}) {
  const [rule, setRule] = useState<DocTidyRuleInput>(initial)
  const [useLookback, setUseLookback] = useState(Boolean(initial.lookbackDays))
  const [errors, setErrors] = useState<Errors>({})
  const [openSections, setOpenSections] = useState<Record<SectionId, boolean>>(INITIAL_SECTIONS)

  const toggleSection = (id: SectionId) =>
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }))

  const nameRef = useRef<HTMLInputElement>(null)
  const lookbackRef = useRef<HTMLInputElement>(null)
  const dateToRef = useRef<HTMLInputElement>(null)
  const titleId = useId()

  const set = <K extends keyof DocTidyRuleInput>(key: K, value: DocTidyRuleInput[K]) => {
    setRule((prev) => ({ ...prev, [key]: value }))
    setErrors({})
  }

  // Escape closes the dialog. Read through a ref so the listener is bound once:
  // `onCancel` is an inline arrow in the page, so a dependency on it would tear
  // the effect down and re-run it — stealing focus back — on every parent render.
  const cancelRef = useRef(onCancel)
  useEffect(() => {
    cancelRef.current = onCancel
  }, [onCancel])

  // Open focused on the first field, and stop the page behind the overlay from
  // scrolling with it.
  useEffect(() => {
    nameRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancelRef.current()
    }
    document.addEventListener('keydown', onKeyDown)

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [])

  // The date mode toggle decides which of the two ranges is persisted, so the
  // preview has to resolve it the same way the submit does.
  const resolved = useMemo<DocTidyRuleInput>(
    () => ({
      ...rule,
      lookbackDays: useLookback ? rule.lookbackDays || 30 : null,
      dateFrom: useLookback ? null : rule.dateFrom,
      dateTo: useLookback ? null : rule.dateTo,
    }),
    [rule, useLookback]
  )

  const submit = () => {
    const next: Errors = {}

    if (!rule.name.trim()) next.name = 'Give the rule a name so it can be identified in results.'

    if (useLookback) {
      const days = Number(rule.lookbackDays)
      if (!Number.isFinite(days) || days < 1 || days > 3650) {
        next.lookback = 'Enter a number of days between 1 and 3650.'
      }
    } else if (rule.dateFrom && rule.dateTo && String(rule.dateFrom) > String(rule.dateTo)) {
      next.dates = 'The end date is before the start date.'
    }

    if (Object.keys(next).length) {
      setErrors(next)

      // The offending field may be inside a collapsed section, so expand it
      // first and focus on the next frame, once React has committed the panel.
      const section: SectionId = next.name ? 'basics' : 'timeframe'
      const field = next.name ? nameRef : next.lookback ? lookbackRef : dateToRef

      setOpenSections((prev) => ({ ...prev, [section]: true }))
      requestAnimationFrame(() => {
        field.current?.focus()
        field.current?.scrollIntoView({ block: 'center' })
      })
      return
    }

    onSave({ ...resolved, name: rule.name.trim() })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/25 backdrop-blur-[2px]" onClick={onCancel} />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[var(--bg-300)] bg-[var(--bg-100)] shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-[var(--bg-300)] px-6 py-4">
          <div>
            <h2 id={titleId} className="text-base font-semibold text-[var(--text-100)]">
              {isNew ? 'New extraction rule' : 'Edit extraction rule'}
            </h2>
            <p className="mt-0.5 text-xs text-[var(--text-200)]">
              A message is extracted when it satisfies every section below. Leave a section empty to
              place no condition on it.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="-mr-1 -mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--text-200)] hover:bg-[var(--bg-200)] hover:text-[var(--text-100)] cursor-pointer"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto px-6 py-5">
          <Section
            step={1}
            title="Basics"
            description="How this rule is identified in the rules list and the results table."
            summary={SECTION_SUMMARY.basics(rule)}
            open={openSections.basics}
            invalid={Boolean(errors.name)}
            onToggle={() => toggleSection('basics')}
          >
            <div className="flex items-center justify-between rounded-lg border border-[var(--bg-300)] px-4 py-3">
              <div>
                <p className="text-sm font-medium text-[var(--text-100)]">Enabled</p>
                <p className="text-xs text-[var(--text-200)]">
                  Disabled rules are skipped by automatic extraction and by “Run all”.
                </p>
              </div>
              <ToggleSwitch
                checked={rule.enabled}
                onChange={(v) => set('enabled', v)}
                title={rule.enabled ? 'Disable this rule' : 'Enable this rule'}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <FieldLabel htmlFor="rule-name" label="Name" required />
                <input
                  id="rule-name"
                  ref={nameRef}
                  type="text"
                  value={rule.name}
                  onChange={(e) => set('name', e.target.value)}
                  placeholder="e.g. Acme supplier invoices"
                  aria-invalid={Boolean(errors.name)}
                  className={`${inputClass} ${errors.name ? errorInputClass : ''}`}
                />
                <FieldError message={errors.name} />
              </div>
              <div className="space-y-1.5">
                <FieldLabel htmlFor="rule-description" label="Description" hint="optional" />
                <input
                  id="rule-description"
                  type="text"
                  value={rule.description ?? ''}
                  onChange={(e) => set('description', e.target.value)}
                  placeholder="What this rule collects"
                  className={inputClass}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <FieldLabel label="Document type" hint="shown on every message this rule captures" />
              <DocumentTypePicker
                value={documentTypeOf(rule.documentType)}
                onChange={(v) => set('documentType', v)}
              />
            </div>
          </Section>

          <Section
            step={2}
            title="Senders and recipients"
            description="Restricts the rule to mail from, or delivered to, specific addresses. A partial address or a bare domain works."
            summary={SECTION_SUMMARY.senders(rule)}
            open={openSections.senders}
            invalid={false}
            onToggle={() => toggleSection('senders')}
          >
            <ChipInput
              label="Sender emails"
              hint="address or domain"
              values={rule.fromAddresses}
              onChange={(v) => set('fromAddresses', v)}
              placeholder="billing@acme.com — press Enter to add"
            />
            <ChipInput
              label="Delivered to"
              hint="the group or recipient address the mail arrived under"
              values={rule.toAddresses}
              onChange={(v) => set('toAddresses', v)}
              placeholder="invoice@outdoorequipped.com — press Enter to add"
            />
          </Section>

          <Section
            step={3}
            title="Keywords"
            description="Terms looked for in the subject line and the message body. Exclusions always win over a match."
            summary={SECTION_SUMMARY.keywords(rule)}
            open={openSections.keywords}
            invalid={false}
            onToggle={() => toggleSection('keywords')}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <ChipInput
                label="Subject keywords"
                values={rule.subjectKeywords}
                onChange={(v) => set('subjectKeywords', v)}
                placeholder="invoice, statement"
              />
              <ChipInput
                label="Body keywords"
                values={rule.bodyKeywords}
                onChange={(v) => set('bodyKeywords', v)}
                placeholder="purchase order"
              />
            </div>

            <ChipInput
              label="Exclude keywords"
              hint="a message containing any of these is skipped"
              values={rule.excludeKeywords}
              onChange={(v) => set('excludeKeywords', v)}
              placeholder="reminder, draft"
            />

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--bg-300)] px-4 py-3">
              <div>
                <p className="text-sm font-medium text-[var(--text-100)]">Keyword matching</p>
                <p className="text-xs text-[var(--text-200)]">
                  {rule.matchMode === 'all'
                    ? 'Every keyword above must appear in the message.'
                    : 'One keyword from any group is enough to match.'}
                </p>
              </div>
              <Segmented<MatchMode>
                ariaLabel="Keyword matching"
                value={rule.matchMode}
                onChange={(v) => set('matchMode', v)}
                options={[
                  { value: 'any', label: 'Any keyword' },
                  { value: 'all', label: 'All keywords' },
                ]}
              />
            </div>
          </Section>

          <Section
            step={4}
            title="Timeframe"
            description="How far back each run looks. A rolling window keeps up with new mail; fixed dates suit a one-off backfill."
            summary={SECTION_SUMMARY.timeframe(resolved)}
            open={openSections.timeframe}
            invalid={Boolean(errors.lookback || errors.dates)}
            onToggle={() => toggleSection('timeframe')}
          >
            <Segmented
              ariaLabel="Timeframe mode"
              value={useLookback ? 'rolling' : 'fixed'}
              onChange={(v) => {
                setUseLookback(v === 'rolling')
                setErrors({})
              }}
              options={[
                { value: 'rolling', label: 'Rolling window' },
                { value: 'fixed', label: 'Fixed dates' },
              ]}
            />

            {useLookback ? (
              <div className="space-y-1.5">
                <FieldLabel htmlFor="rule-lookback" label="Look back" />
                <div className="flex items-center gap-2">
                  <input
                    id="rule-lookback"
                    ref={lookbackRef}
                    type="number"
                    min={1}
                    max={3650}
                    value={rule.lookbackDays ?? 30}
                    onChange={(e) => set('lookbackDays', Number(e.target.value))}
                    aria-invalid={Boolean(errors.lookback)}
                    className={`${inputClass} w-28 ${errors.lookback ? errorInputClass : ''}`}
                  />
                  <span className="text-sm text-[var(--text-200)]">days from the run date</span>
                </div>
                <FieldError message={errors.lookback} />
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <FieldLabel htmlFor="rule-date-from" label="From" hint="optional" />
                    <input
                      id="rule-date-from"
                      type="date"
                      value={rule.dateFrom ? String(rule.dateFrom).slice(0, 10) : ''}
                      onChange={(e) => set('dateFrom', e.target.value || null)}
                      aria-invalid={Boolean(errors.dates)}
                      className={`${inputClass} ${errors.dates ? errorInputClass : ''}`}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <FieldLabel htmlFor="rule-date-to" label="To" hint="optional" />
                    <input
                      id="rule-date-to"
                      ref={dateToRef}
                      type="date"
                      value={rule.dateTo ? String(rule.dateTo).slice(0, 10) : ''}
                      onChange={(e) => set('dateTo', e.target.value || null)}
                      aria-invalid={Boolean(errors.dates)}
                      className={`${inputClass} ${errors.dates ? errorInputClass : ''}`}
                    />
                  </div>
                </div>
                <FieldError message={errors.dates} />
              </div>
            )}
          </Section>

          <Section
            step={5}
            title="Attachments"
            description="Attachments on a matching message are copied into the configured Drive folder."
            summary={SECTION_SUMMARY.attachments(rule)}
            open={openSections.attachments}
            invalid={false}
            onToggle={() => toggleSection('attachments')}
          >
            <div className="flex items-center justify-between rounded-lg border border-[var(--bg-300)] px-4 py-3">
              <div>
                <p className="text-sm font-medium text-[var(--text-100)]">Require an attachment</p>
                <p className="text-xs text-[var(--text-200)]">
                  Messages with no matching attachment are not extracted.
                </p>
              </div>
              <ToggleSwitch
                checked={rule.requireAttachment}
                onChange={(v) => set('requireAttachment', v)}
                title="Require an attachment"
              />
            </div>

            <ChipInput
              label="Attachment file types"
              hint="leave empty to accept every file type"
              values={rule.attachmentExtensions}
              onChange={(v) => set('attachmentExtensions', v)}
              placeholder="pdf, xlsx — press Enter to add"
            />
          </Section>
        </div>

        <div className="border-t border-[var(--bg-300)] bg-[var(--bg-200)] px-6 py-3">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-200)]">
            This rule will match
          </p>
          <RuleCriteria rule={resolved} />
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-[var(--bg-300)] bg-[var(--bg-100)] px-6 py-4">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-[var(--bg-300)] px-4 py-2 text-sm font-medium text-[var(--text-200)] hover:bg-[var(--bg-200)] cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent-200)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {saving && <Spinner />}
            {isNew ? 'Create rule' : 'Save changes'}
          </button>
        </footer>
      </div>
    </div>
  )
}
