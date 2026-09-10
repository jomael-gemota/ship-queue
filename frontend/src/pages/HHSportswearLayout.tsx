import { useLayoutEffect, useRef, useState } from 'react'
import { useLocation, useOutlet, useParams } from 'react-router-dom'
import { HHFilterBar } from '../components/hh/HHFilterBar'
import { HHBackButton, HHBreadcrumb } from '../components/hh/hhUi'
import { HHListProvider } from '../context/HHListContext'
import { hhBreadcrumbPage, hhDirection, hhParentPath, prefersReducedMotion } from '../lib/hhNav'

function HHSportswearShell() {
  const location = useLocation()
  const { groupId } = useParams<{ groupId: string }>()
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

  const backTo = hhParentPath(location.pathname, groupId)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <HHBreadcrumb current={hhBreadcrumbPage(location.pathname)} groupId={groupId} />
        {backTo && <HHBackButton to={backTo} />}
      </div>
      <section className="overflow-hidden rounded-xl border border-[var(--bg-300)] bg-[var(--bg-100)] shadow-sm dark:border-[var(--bg-300)] dark:bg-[var(--bg-100)]">
        <HHFilterBar />
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
