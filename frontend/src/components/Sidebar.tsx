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

const INVOICE_AUDIT_ITEMS = [
  {
    label: 'Doc Tidy',
    to: '/doc-tidy',
    icon: (
      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z"
        />
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

export default function Sidebar({ isOpen = true }: { isOpen?: boolean }) {
  const { user, logout } = useAuth()

  return (
    <aside className={`${isOpen ? 'w-64' : 'w-16'} shrink-0 self-start sticky top-0 h-screen z-30 border-r border-[var(--bg-300)] dark:border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-100)] backdrop-blur overflow-hidden transition-[width] duration-200 ease-in-out`}>
      <div className="h-16 px-3 flex items-center gap-3 border-b border-[var(--bg-300)] dark:border-[var(--bg-300)]">
        <span className="h-9 w-9 shrink-0 rounded-xl bg-[var(--bg-200)] dark:bg-[var(--bg-200)] border border-[var(--bg-300)] dark:border-[var(--bg-300)] p-1 flex items-center justify-center">
          <img src="/ship-queue-logo.svg" alt="Ship Queue logo" className="h-full w-full object-contain" />
        </span>
        <div className={`${isOpen ? 'opacity-100' : 'opacity-0'} transition-opacity duration-150 min-w-0 overflow-hidden`}>
          <p className="text-sm font-semibold text-[var(--text-100)] dark:text-[var(--text-100)] leading-5 whitespace-nowrap">Ship Queue</p>
          <p className="text-xs text-[var(--text-200)] dark:text-[var(--text-200)] whitespace-nowrap">SM Department</p>
        </div>
      </div>

      <div className="h-[calc(100vh-4rem)] flex flex-col">
        <nav className="p-3 space-y-1.5">
          {isOpen && (
            <div className="pt-1 pb-0.5 px-1">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-200)] dark:text-[var(--text-200)] whitespace-nowrap">ShipStation</p>
            </div>
          )}
          {MENU_ITEMS.map((item) => (
            <NavLink
              key={item.label}
              to={item.to}
              end={item.end}
              title={item.label}
              className={({ isActive }) =>
                `flex items-center ${isOpen ? 'justify-start' : 'justify-center'} gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-all ${
                  isActive
                    ? 'bg-[var(--primary-100)] text-[var(--accent-200)] dark:bg-[var(--primary-100)] dark:text-[var(--accent-200)] font-medium shadow-sm'
                    : 'text-[var(--text-200)] dark:text-[var(--text-200)] hover:bg-[var(--primary-100)] dark:hover:bg-[var(--primary-100)] hover:text-[var(--text-100)] dark:hover:text-[var(--text-100)]'
                }`
              }
            >
              {item.icon}
              {isOpen && <span className="whitespace-nowrap">{item.label}</span>}
            </NavLink>
          ))}

          {isOpen ? (
            <div className="pt-2 pb-0.5 px-1">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-200)] dark:text-[var(--text-200)] whitespace-nowrap">Invoice Auditing</p>
            </div>
          ) : (
            <div className="border-t border-[var(--bg-300)] my-1" />
          )}
          {INVOICE_AUDIT_ITEMS.map((item) => (
            <NavLink
              key={item.label}
              to={item.to}
              title={item.label}
              className={({ isActive }) =>
                `flex items-center ${isOpen ? 'justify-start' : 'justify-center'} gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-all ${
                  isActive
                    ? 'bg-[var(--primary-100)] text-[var(--accent-200)] dark:bg-[var(--primary-100)] dark:text-[var(--accent-200)] font-medium shadow-sm'
                    : 'text-[var(--text-200)] dark:text-[var(--text-200)] hover:bg-[var(--primary-100)] dark:hover:bg-[var(--primary-100)] hover:text-[var(--text-100)] dark:hover:text-[var(--text-100)]'
                }`
              }
            >
              {item.icon}
              {isOpen && <span className="whitespace-nowrap">{item.label}</span>}
            </NavLink>
          ))}

          {isOpen ? (
            <div className="pt-2 pb-0.5 px-1">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-200)] dark:text-[var(--text-200)] whitespace-nowrap">Admin</p>
            </div>
          ) : (
            <div className="border-t border-[var(--bg-300)] my-1" />
          )}
          {ADMIN_ITEMS.map((item) => (
            <NavLink
              key={item.label}
              to={item.to}
              title={item.label}
              className={({ isActive }) =>
                `flex items-center ${isOpen ? 'justify-start' : 'justify-center'} gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-all ${
                  isActive
                    ? 'bg-[var(--primary-100)] text-[var(--accent-200)] dark:bg-[var(--primary-100)] dark:text-[var(--accent-200)] font-medium shadow-sm'
                    : 'text-[var(--text-200)] dark:text-[var(--text-200)] hover:bg-[var(--primary-100)] dark:hover:bg-[var(--primary-100)] hover:text-[var(--text-100)] dark:hover:text-[var(--text-100)]'
                }`
              }
            >
              {item.icon}
              {isOpen && <span className="whitespace-nowrap">{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto p-3 border-t border-[var(--bg-300)] dark:border-[var(--bg-300)]">
          {user && isOpen && (
            <div className="flex items-center gap-2.5 mb-2.5">
              {user.avatar ? (
                <img
                  src={user.avatar}
                  alt={user.name}
                  className="w-8 h-8 shrink-0 rounded-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="w-8 h-8 shrink-0 rounded-full bg-slate-700 text-white text-xs font-semibold flex items-center justify-center select-none">
                  {user.name.charAt(0).toUpperCase()}
                </span>
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--text-100)] dark:text-[var(--text-200)] truncate whitespace-nowrap">{user.name}</p>
                <p className="text-xs text-[var(--text-200)] dark:text-[var(--text-200)] truncate whitespace-nowrap">{user.email}</p>
              </div>
            </div>
          )}

          <button
            onClick={logout}
            title="Sign out"
            className={`w-full inline-flex items-center ${isOpen ? 'justify-start' : 'justify-center'} gap-2 rounded-lg px-2.5 py-2 text-sm text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors cursor-pointer`}
          >
            <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 16l4-4m0 0l-4-4m4 4H9m4 4v1a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h6a2 2 0 012 2v1"
              />
            </svg>
            {isOpen && <span className="whitespace-nowrap">Sign out</span>}
          </button>
        </div>
      </div>
    </aside>
  )
}
