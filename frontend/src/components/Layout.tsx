import { Outlet, useLocation } from 'react-router-dom'
import Navbar from './Navbar'
import Sidebar from './Sidebar'

export default function Layout() {
  const { pathname } = useLocation()
  // Data-dense pages (ShipStation Orders, the Label Batches list + batch items,
  // Settings, and User Management) use the full content width so wide tables and
  // sections can breathe without horizontal scrolling; everything else stays
  // centered at a comfortable cap.
  const fullWidth =
    pathname === '/' ||
    pathname.startsWith('/create-label') ||
    pathname.startsWith('/dropbox-fetcher') ||
    pathname.startsWith('/settings') ||
    pathname.startsWith('/admin')

  return (
    <div className="min-h-screen bg-[var(--bg-200)] dark:bg-[var(--bg-100)]">
      <div className="flex min-h-screen">
        <Sidebar />
        <div className="flex-1 min-w-0 flex flex-col">
          <Navbar />
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
