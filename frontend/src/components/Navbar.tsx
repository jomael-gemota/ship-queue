import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'

export default function Navbar() {
  const { pathname } = useLocation()

  const pageTitle = useMemo(() => {
    if (pathname === '/orders') return 'Orders'
    return 'Dashboard'
  }, [pathname])

  const today = useMemo(
    () =>
      new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }).format(new Date()),
    []
  )

  return (
    <header className="h-16 bg-white/85 dark:bg-gray-900/85 border-b border-slate-200/80 dark:border-gray-800 backdrop-blur">
      <div className="h-full px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-gray-400">
            Enterprise Shipping Platform
          </p>
          <h1 className="text-lg sm:text-xl font-semibold text-slate-900 dark:text-white truncate">
            {pageTitle}
          </h1>
        </div>
        <div className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50 dark:border-gray-700 dark:bg-gray-800 px-3 py-1.5">
          <span className="text-xs sm:text-sm text-slate-600 dark:text-gray-300">{today}</span>
        </div>
      </div>
    </header>
  )
}
