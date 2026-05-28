import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const MENU_ITEMS = [
  {
    label: 'Dashboard',
    to: '/',
    end: true,
    icon: (
      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M3 11l9-8 9 8M5 10v10h14V10"
        />
      </svg>
    ),
  },
  {
    label: 'Orders',
    to: '/orders',
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
]

export default function Sidebar() {
  const { user, logout } = useAuth()

  return (
    <aside className="w-20 sm:w-64 shrink-0 self-start sticky top-0 h-screen z-30 border-r border-slate-200/80 dark:border-gray-800 bg-white/95 dark:bg-gray-900/95 backdrop-blur">
      <div className="h-16 px-3 sm:px-4 flex items-center gap-3 border-b border-slate-200/80 dark:border-gray-800">
        <span className="h-9 w-9 rounded-xl bg-blue-600 text-white flex items-center justify-center text-lg">
          🚢
        </span>
        <div className="hidden sm:block min-w-0">
          <p className="text-sm font-semibold text-slate-900 dark:text-white leading-5">Ship Queue</p>
          <p className="text-xs text-slate-500 dark:text-gray-400">Operations Console</p>
        </div>
      </div>

      <div className="h-[calc(100vh-4rem)] flex flex-col">
        <nav className="p-3 space-y-1.5">
          {MENU_ITEMS.map((item) => (
            <NavLink
              key={item.label}
              to={item.to}
              end={item.end}
              title={item.label}
              className={({ isActive }) =>
                `flex items-center justify-center sm:justify-start gap-2.5 rounded-lg px-2.5 sm:px-3 py-2 text-sm transition-all ${
                  isActive
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 font-medium shadow-sm'
                    : 'text-slate-600 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-800 hover:text-slate-900 dark:hover:text-white'
                }`
              }
            >
              {item.icon}
              <span className="hidden sm:inline">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto p-3 border-t border-slate-200/80 dark:border-gray-800">
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
                <p className="text-sm font-medium text-slate-800 dark:text-gray-200 truncate">{user.name}</p>
                <p className="text-xs text-slate-500 dark:text-gray-400 truncate">{user.email}</p>
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
