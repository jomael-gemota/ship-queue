import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const MENU_ITEMS = [
  {
    label: 'ShipStation Orders',
    to: '/',
    end: true,
    icon: (
      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 12h6m-6 4h6M7 4h7l5 5v11H7V4z"
        />
      </svg>
    ),
  },
  {
    label: 'Create Shipping Label',
    to: '/create-label',
    icon: (
      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M7 7h10M7 11h6m-1 8H6a2 2 0 01-2-2V5a2 2 0 012-2h7l5 5v3m-2 5h6m-3-3v6"
        />
      </svg>
    ),
  },
  {
    label: 'Dropbox Fetcher',
    to: '/dropbox-fetcher',
    icon: (
      <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
        <path d="M6 2 0 5.9l6 3.9 6-3.9L6 2Zm12 0-6 3.9 6 3.9 6-3.9L18 2ZM0 13.7l6 3.9 6-3.9-6-3.9-6 3.9Zm18-3.9-6 3.9 6 3.9 6-3.9-6-3.9ZM6 18.9l6 3.9 6-3.9-6-3.9-6 3.9Z" />
      </svg>
    ),
  },
]

/** Items under the "Admin" header. Visible to everyone in the sidebar; each
 * destination enforces its own access (Settings is open to all, User
 * Management is admin-only and shows a blocking note to non-admins). */
const ADMIN_ITEMS = [
  {
    label: 'Settings',
    to: '/settings',
    icon: (
      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
        />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    label: 'User Management',
    to: '/admin/users',
    icon: (
      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
]

export default function Sidebar() {
  const { user, logout } = useAuth()

  return (
    <aside className="w-20 sm:w-64 shrink-0 self-start sticky top-0 h-screen z-30 border-r border-[var(--bg-300)] dark:border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-100)] backdrop-blur">
      <div className="h-16 px-3 sm:px-4 flex items-center gap-3 border-b border-[var(--bg-300)] dark:border-[var(--bg-300)]">
        <span className="h-9 w-9 rounded-xl bg-[var(--bg-200)] dark:bg-[var(--bg-200)] border border-[var(--bg-300)] dark:border-[var(--bg-300)] p-1 flex items-center justify-center">
          <img src="/ship-queue-logo.svg" alt="Ship Queue logo" className="h-full w-full object-contain" />
        </span>
        <div className="hidden sm:block min-w-0">
          <p className="text-sm font-semibold text-[var(--text-100)] dark:text-[var(--text-100)] leading-5">Ship Queue</p>
          <p className="text-xs text-[var(--text-200)] dark:text-[var(--text-200)]">Operations Console</p>
        </div>
      </div>

      <div className="h-[calc(100vh-4rem)] flex flex-col">
        <nav className="p-3 space-y-1.5">
          <div className="hidden sm:block pt-1 pb-0.5 px-1">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-200)] dark:text-[var(--text-200)]">Operations</p>
          </div>
          {MENU_ITEMS.map((item) => (
            <NavLink
              key={item.label}
              to={item.to}
              end={item.end}
              title={item.label}
              className={({ isActive }) =>
                `flex items-center justify-center sm:justify-start gap-2.5 rounded-lg px-2.5 sm:px-3 py-2 text-sm transition-all ${
                  isActive
                    ? 'bg-[var(--primary-100)] text-[var(--accent-200)] dark:bg-[var(--primary-100)] dark:text-[var(--accent-200)] font-medium shadow-sm'
                    : 'text-[var(--text-200)] dark:text-[var(--text-200)] hover:bg-[var(--primary-100)] dark:hover:bg-[var(--primary-100)] hover:text-[var(--text-100)] dark:hover:text-[var(--text-100)]'
                }`
              }
            >
              {item.icon}
              <span className="hidden sm:inline">{item.label}</span>
            </NavLink>
          ))}

          <div className="hidden sm:block pt-2 pb-0.5 px-1">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-200)] dark:text-[var(--text-200)]">Admin</p>
          </div>
          <div className="sm:hidden border-t border-slate-200 dark:border-[var(--bg-300)] my-1" />
          {ADMIN_ITEMS.map((item) => (
            <NavLink
              key={item.label}
              to={item.to}
              title={item.label}
              className={({ isActive }) =>
                `flex items-center justify-center sm:justify-start gap-2.5 rounded-lg px-2.5 sm:px-3 py-2 text-sm transition-all ${
                  isActive
                    ? 'bg-[var(--primary-100)] text-[var(--accent-200)] dark:bg-[var(--primary-100)] dark:text-[var(--accent-200)] font-medium shadow-sm'
                    : 'text-[var(--text-200)] dark:text-[var(--text-200)] hover:bg-[var(--primary-100)] dark:hover:bg-[var(--primary-100)] hover:text-[var(--text-100)] dark:hover:text-[var(--text-100)]'
                }`
              }
            >
              {item.icon}
              <span className="hidden sm:inline">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto p-3 border-t border-[var(--bg-300)] dark:border-[var(--bg-300)]">
          {user && (
            <div className="hidden sm:flex items-center gap-2.5 mb-2.5">
              {user.avatar ? (
                <img
                  src={user.avatar}
                  alt={user.name}
                  className="w-8 h-8 rounded-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="w-8 h-8 rounded-full bg-slate-700 text-white text-xs font-semibold flex items-center justify-center select-none">
                  {user.name.charAt(0).toUpperCase()}
                </span>
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--text-100)] dark:text-[var(--text-200)] truncate">{user.name}</p>
                <p className="text-xs text-[var(--text-200)] dark:text-[var(--text-200)] truncate">{user.email}</p>
              </div>
            </div>
          )}

          <button
            onClick={logout}
            className="w-full inline-flex items-center justify-center sm:justify-start gap-2 rounded-lg px-2.5 sm:px-3 py-2 text-sm text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors cursor-pointer"
          >
            <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 16l4-4m0 0l-4-4m4 4H9m4 4v1a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h6a2 2 0 012 2v1"
              />
            </svg>
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </div>
    </aside>
  )
}
