import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { useTheme } from '../context/ThemeContext'

export default function Navbar() {
  const { pathname } = useLocation()
  const { theme, toggleTheme } = useTheme()
  const isDarkTheme = theme === 'dark'
  const themeToggleLabel = isDarkTheme ? 'Switch to light mode' : 'Switch to dark mode'

  const pageTitle = useMemo(() => {
    if (pathname === '/orders') return 'Orders'
    if (pathname === '/create-label') return 'Create Shipping Label'
    if (pathname === '/settings') return 'Settings'
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
    <header className="h-16 bg-slate-50/90 dark:bg-gray-900/85 border-b border-slate-300/60 dark:border-gray-800 backdrop-blur">
      <div className="h-full px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-gray-400">
            Enterprise Shipping Platform
          </p>
          <h1 className="text-lg sm:text-xl font-semibold text-slate-900 dark:text-white truncate">
            {pageTitle}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-1.5 px-1 text-slate-600 dark:text-gray-300">
            <svg className="h-4 w-4 text-slate-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.8}
                d="M8 7V4m8 3V4M5 11h14m-1 9H6a2 2 0 01-2-2V8a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2z"
              />
            </svg>
            <span className="text-xs sm:text-sm font-medium tracking-wide">{today}</span>
          </div>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={themeToggleLabel}
            title={themeToggleLabel}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300/80 bg-slate-100/90 px-3 py-1.5 text-xs sm:text-sm font-medium text-slate-700 hover:bg-slate-200/80 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700 transition-colors cursor-pointer"
          >
            {isDarkTheme ? (
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4V2m0 20v-2m8-8h2M2 12H4m13.657 5.657 1.414 1.414M4.929 4.929l1.414 1.414m11.314-1.414-1.414 1.414M6.343 17.657l-1.414 1.414M12 8a4 4 0 100 8 4 4 0 000-8z"
                />
              </svg>
            ) : (
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M20.354 15.354A9 9 0 018.646 3.646a9 9 0 1011.708 11.708z"
                />
              </svg>
            )}
            <span className="hidden sm:inline">{isDarkTheme ? 'Light' : 'Dark'} Mode</span>
          </button>
        </div>
      </div>
    </header>
  )
}
