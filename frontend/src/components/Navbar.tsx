import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { useTheme } from '../context/ThemeContext'
import { bulkOrderTitle } from '../lib/bulkOrder'
import { HH_BRAND_IDS, HH_BRANDS, hhBrand, hhBrandFromPath } from '../lib/hhBrand'
import { hhBreadcrumbPage } from '../lib/hhNav'

export default function Navbar({
  onToggleSidebar,
  sidebarOpen: _sidebarOpen,
}: {
  onToggleSidebar: () => void
  sidebarOpen: boolean
}) {
  const { pathname } = useLocation()
  const { theme, toggleTheme } = useTheme()
  const isDarkTheme = theme === 'dark'
  const themeToggleLabel = isDarkTheme ? 'Switch to light mode' : 'Switch to dark mode'

  const isOrdering = pathname.startsWith('/ordering')
  const pageTitle = useMemo(() => {
    if (pathname.startsWith('/create-label/batches')) return 'Batch Items'
    if (pathname === '/create-label') return 'Create Shipping Label'
    if (pathname === '/dropbox-fetcher') return 'Dropbox Fetcher'
    if (pathname.startsWith('/doc-tidy')) return 'Doc Tidy'
    const bulkTitle = bulkOrderTitle(pathname)
    if (bulkTitle) return bulkTitle
    if (HH_BRAND_IDS.some((id) => pathname.includes(`/${HH_BRANDS[id].slug}`))) {
      const name = hhBrand(hhBrandFromPath(pathname)).name
      const page = hhBreadcrumbPage(pathname)
      if (page === 'items') return `${name} Items`
      if (page === 'orders') return `${name} Orders`
      return name
    }
    if (pathname === '/ordering' || pathname === '/ordering/') return 'Dropship (B2B)'
    if (pathname === '/settings') return 'Settings'
    if (pathname === '/admin/users') return 'User Management'
    return 'ShipStation Orders'
  }, [pathname])

  const platformLabel = isOrdering ? 'Enterprise Ordering Platform' : 'Enterprise Shipping Platform'

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
    <header className="sticky top-0 z-40 h-16 bg-[var(--bg-100)] dark:bg-[var(--bg-100)] border-b border-[var(--bg-300)] dark:border-[var(--bg-300)] backdrop-blur">
      <div className="h-full px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {/* Sidebar burger toggle */}
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label="Toggle sidebar"
            title="Toggle sidebar"
            className="inline-flex shrink-0 items-center justify-center rounded-lg border border-[var(--bg-300)] bg-[var(--bg-200)] p-1.5 text-[var(--text-200)] hover:bg-[var(--primary-100)] hover:text-[var(--text-100)] transition-colors cursor-pointer"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-[var(--text-200)] dark:text-[var(--text-200)]">
              {platformLabel}
            </p>
            <h1 className="text-lg sm:text-xl font-semibold text-[var(--text-100)] dark:text-[var(--text-100)] truncate">
              {pageTitle}
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-1.5 px-1 text-[var(--text-200)] dark:text-[var(--text-200)]">
            <svg className="h-4 w-4 text-[var(--primary-200)] dark:text-[var(--text-200)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.8}
                d="M8 7V4m8 3V4M5 11h14m-1 9H6a2 2 0 01-2-2V8a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2z"
              />
            </svg>
            <span className="text-xs sm:text-sm font-medium tracking-wide">{today}</span>
          </div>
          {/* Theme toggle — pill with sun / moon */}
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={themeToggleLabel}
            title={themeToggleLabel}
            className="relative inline-flex items-center rounded-full border border-[var(--bg-300)] bg-[var(--bg-200)] p-0.5 shadow-sm transition-colors duration-200 hover:border-[var(--primary-200)] cursor-pointer"
          >
            {/* Sun icon slot */}
            <span
              className={`flex items-center justify-center rounded-full w-7 h-7 transition-all duration-200 ${
                !isDarkTheme
                  ? 'bg-[var(--primary-200)] text-white shadow'
                  : 'text-[var(--text-200)] hover:text-[var(--text-100)]'
              }`}
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 4V2m0 20v-2m8-8h2M2 12H4m13.657 5.657 1.414 1.414M4.929 4.929l1.414 1.414m11.314-1.414-1.414 1.414M6.343 17.657l-1.414 1.414M12 8a4 4 0 100 8 4 4 0 000-8z"
                />
              </svg>
            </span>
            {/* Moon icon slot */}
            <span
              className={`flex items-center justify-center rounded-full w-7 h-7 transition-all duration-200 ${
                isDarkTheme
                  ? 'bg-[var(--primary-200)] text-white shadow'
                  : 'text-[var(--text-200)] hover:text-[var(--text-100)]'
              }`}
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M20.354 15.354A9 9 0 018.646 3.646a9 9 0 1011.708 11.708z"
                />
              </svg>
            </span>
          </button>
        </div>
      </div>
    </header>
  )
}
