import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Navbar from './Navbar'
import Sidebar from './Sidebar'

const SIDEBAR_KEY = 'ship-queue-sidebar-open'

function getInitialSidebarOpen(): boolean {
  try {
    const saved = window.localStorage.getItem(SIDEBAR_KEY)
    if (saved !== null) return saved === 'true'
  } catch { /* ignore */ }
  return true
}

export default function Layout() {
  const { pathname } = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(getInitialSidebarOpen)

  const toggleSidebar = () => {
    setSidebarOpen((prev) => {
      const next = !prev
      try { window.localStorage.setItem(SIDEBAR_KEY, String(next)) } catch { /* ignore */ }
      return next
    })
  }

  // Data-dense pages (ShipStation Orders, the Label Batches list + batch items,
  // Settings, and User Management) use the full content width so wide tables and
  // sections can breathe without horizontal scrolling; everything else stays
  // centered at a comfortable cap.
  const fullWidth =
    pathname === '/' ||
    pathname.startsWith('/create-label') ||
    pathname.startsWith('/dropbox-fetcher') ||
    pathname.startsWith('/doc-tidy') ||
    pathname.startsWith('/settings') ||
    pathname.startsWith('/admin')

  return (
    <div className="min-h-screen bg-[var(--bg-200)] dark:bg-[var(--bg-100)]">
      <div className="flex min-h-screen">
        <Sidebar isOpen={sidebarOpen} />
        <div className="flex-1 min-w-0 flex flex-col">
          <Navbar onToggleSidebar={toggleSidebar} sidebarOpen={sidebarOpen} />
          <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6">
            <div className={fullWidth ? '' : 'max-w-[1400px] mx-auto'}>
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}
