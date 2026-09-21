import { useLayoutEffect, useRef, useState } from 'react'
import { Link, useLocation, useOutlet, useParams } from 'react-router-dom'
import { HHFilterBar } from '../components/hh/HHFilterBar'
import { HHBackButton, HHBreadcrumb } from '../components/hh/hhUi'
import { HHImportButton } from '../components/hh/HHImportButton'
import { HHListProvider, useHHList } from '../context/HHListContext'
import { hhBreadcrumbPage, hhDirection, hhParentPath, prefersReducedMotion } from '../lib/hhNav'

function HHSportswearShell() {
  const location = useLocation()
  const { groupId } = useParams<{ groupId: string }>()
  const { brandName, brandPath } = useHHList()
  const outlet = useOutlet()
  const pathnameRef = useRef(location.pathname)
  const snapshotRef = useRef(outlet)
  const [leaving, setLeaving] = useState<{
    node: ReturnType<typeof useOutlet>
    direction: 'forward' | 'back'
  } | null>(null)

  useLayoutEffect(() => {
    if (location.pathname === pathnameRef.current) {
      snapshotRef.current = outlet
      return
    }

    const direction = hhDirection(pathnameRef.current, location.pathname)
    const previousNode = snapshotRef.current
    pathnameRef.current = location.pathname
    snapshotRef.current = outlet

    if (direction === 'none' || prefersReducedMotion()) {
      setLeaving(null)
      return
    }

    setLeaving({ node: previousNode, direction })
  }, [location.pathname, outlet])

  const page = hhBreadcrumbPage(location.pathname)
  const backTo = hhParentPath(location.pathname, groupId)
  const isConfig = page === 'config'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <HHBreadcrumb current={page} groupId={groupId} brandName={brandName} brandPath={brandPath} />
        {backTo ? (
          <HHBackButton to={backTo} />
        ) : (
          <div className="flex items-center gap-2">
            <Link
              to={`${brandPath}/configurations`}
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
            <HHImportButton />
          </div>
        )}
      </div>
      <section className="overflow-hidden rounded-xl border border-[var(--bg-300)] bg-[var(--bg-100)] shadow-sm dark:border-[var(--bg-300)] dark:bg-[var(--bg-100)]">
        {isConfig ? null : <HHFilterBar />}
        <div className="hh-drilldown-viewport">
          {leaving && (
            <div
              className={`hh-drilldown-page hh-drilldown-page--exit-${leaving.direction}`}
              onAnimationEnd={(event) => {
                if (event.target === event.currentTarget) setLeaving(null)
              }}
              aria-hidden="true"
            >
              {leaving.node}
            </div>
          )}
          <div
            className={
              leaving ? `hh-drilldown-page hh-drilldown-page--enter-${leaving.direction}` : 'hh-drilldown-page'
            }
          >
            {outlet}
          </div>
        </div>
      </section>
    </div>
  )
}

export default function HHSportswearLayout() {
  return (
    <HHListProvider>
      <HHSportswearShell />
    </HHListProvider>
  )
}
