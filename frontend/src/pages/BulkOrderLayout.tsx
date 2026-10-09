import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, Navigate, useLocation, useOutlet } from 'react-router-dom'
import { BulkCreateButton } from '../components/bulk/BulkCreateButton'
import { HHBackButton } from '../components/hh/hhUi'
import { bulkDirection, bulkOrderBrand, bulkOrderId, bulkPage, bulkParentPath, BULK_ORDER_PATH } from '../lib/bulkOrder'
import type { BulkPage } from '../lib/bulkOrder'
import { prefersReducedMotion } from '../lib/hhNav'

function CrumbChevron() {
  return (
    <svg className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-[var(--text-200)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  )
}

function BulkBreadcrumb({ page, brandPath, orderId }: { page: BulkPage; brandPath: string; orderId: string | null }) {
  const crumbs: { label: string; to?: string }[] = [{ label: 'Orders', to: page === 'orders' ? undefined : brandPath }]
  if (page === 'shipments' || page === 'items') {
    crumbs.push({
      label: 'Shipments',
      to: page === 'items' && orderId ? `${brandPath}/${orderId}` : undefined,
    })
  }
  if (page === 'items') crumbs.push({ label: 'Items' })
  if (page === 'config') crumbs.push({ label: 'Configurations' })

  return (
    <nav aria-label="Breadcrumb" className="text-sm">
      <ol className="flex flex-wrap items-center gap-1.5 text-slate-500 dark:text-[var(--text-200)]">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1
          return (
            <li key={crumb.label} className="inline-flex items-center gap-1.5">
              {index > 0 ? <CrumbChevron /> : null}
              {crumb.to && !isLast ? (
                <Link to={crumb.to} className="hover:text-slate-700 hover:underline dark:hover:text-[var(--text-100)]">
                  {crumb.label}
                </Link>
              ) : (
                <span className={isLast ? 'font-medium text-slate-800 dark:text-[var(--text-100)]' : undefined} aria-current={isLast ? 'page' : undefined}>
                  {crumb.label}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

function ConfigurationsLink({ to }: { to: string }) {
  return (
    <Link
      to={to}
      className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--bg-300)] bg-[var(--bg-100)] px-3.5 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-[var(--primary-100)] dark:border-[var(--bg-300)] dark:text-[var(--text-100)] dark:hover:bg-[var(--primary-100)]"
    >
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
        />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
      Configurations
    </Link>
  )
}

export default function BulkOrderLayout() {
  const location = useLocation()
  const brand = bulkOrderBrand(location.pathname)
  const outlet = useOutlet()
  const pathnameRef = useRef(location.pathname)
  const snapshotRef = useRef<ReactNode>(outlet)
  const [leaving, setLeaving] = useState<{ node: ReactNode; direction: 'forward' | 'back' } | null>(null)

  useLayoutEffect(() => {
    if (location.pathname === pathnameRef.current) {
      snapshotRef.current = outlet
      return
    }
    const direction = bulkDirection(pathnameRef.current, location.pathname)
    const previousNode = snapshotRef.current
    pathnameRef.current = location.pathname
    snapshotRef.current = outlet
    if (direction === 'none' || prefersReducedMotion()) {
      setLeaving(null)
      return
    }
    setLeaving({ node: previousNode, direction })
  }, [location.pathname, outlet])

  if (!brand) return <Navigate to={BULK_ORDER_PATH} replace />

  const page = bulkPage(location.pathname)
  const orderId = bulkOrderId(location.pathname)
  const backTo = bulkParentPath(location.pathname)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <BulkBreadcrumb page={page} brandPath={brand.path} orderId={orderId} />
        {backTo ? (
          <HHBackButton to={backTo} />
        ) : (
          <div className="flex items-center gap-2">
            <ConfigurationsLink to={`${brand.path}/configurations`} />
            <BulkCreateButton />
          </div>
        )}
      </div>
      <section className="overflow-hidden rounded-xl border border-[var(--bg-300)] bg-[var(--bg-100)] shadow-sm dark:border-[var(--bg-300)] dark:bg-[var(--bg-100)]">
        <div className={leaving ? 'hh-drilldown-viewport is-animating' : 'hh-drilldown-viewport'}>
          {leaving ? (
            <div
              className={`hh-drilldown-page hh-drilldown-page--exit-${leaving.direction}`}
              onAnimationEnd={(event) => {
                if (event.target === event.currentTarget) setLeaving(null)
              }}
              aria-hidden="true"
            >
              {leaving.node}
            </div>
          ) : null}
          <div className={leaving ? `hh-drilldown-page hh-drilldown-page--enter-${leaving.direction}` : 'hh-drilldown-page'}>
            {outlet}
          </div>
        </div>
      </section>
    </div>
  )
}
