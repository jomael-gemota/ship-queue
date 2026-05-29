import { useState, useEffect, useCallback } from 'react'
import { authApi } from '../lib/api'

interface ManagedUser {
  _id: string
  email: string
  name: string
  avatar?: string
  role: 'admin' | 'user'
  canCreateLabels: boolean
  createdAt: string
}

function UserAvatar({ user }: { user: ManagedUser }) {
  if (user.avatar) {
    return (
      <img
        src={user.avatar}
        alt={user.name}
        referrerPolicy="no-referrer"
        className="w-8 h-8 rounded-full object-cover shrink-0"
      />
    )
  }
  return (
    <span className="w-8 h-8 rounded-full bg-slate-200 dark:bg-[var(--bg-300)] text-slate-600 dark:text-[var(--text-200)] text-xs font-semibold flex items-center justify-center shrink-0 select-none">
      {user.name.charAt(0).toUpperCase()}
    </span>
  )
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-200)] ${
        disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
      } ${checked ? 'bg-[var(--accent-200)] dark:bg-[var(--accent-100)]' : 'bg-slate-300 dark:bg-[var(--bg-300)]'}`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
        }`}
      />
    </button>
  )
}

export default function AdminUsers() {
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const loadUsers = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await authApi.get<{ data: ManagedUser[] }>('/admin/users')
      setUsers(res.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadUsers()
  }, [loadUsers])

  const handleToggle = async (user: ManagedUser, value: boolean) => {
    setTogglingId(user._id)
    setError(null)
    try {
      const res = await authApi.patch<{ data: ManagedUser }>(`/admin/users/${user._id}/permissions`, {
        canCreateLabels: value,
      })
      setUsers((prev) => prev.map((u) => (u._id === user._id ? { ...u, ...res.data } : u)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update permission')
    } finally {
      setTogglingId(null)
    }
  }

  const filtered = users.filter(
    (u) =>
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase()),
  )

  const adminCount = users.filter((u) => u.role === 'admin').length
  const permittedCount = users.filter((u) => u.canCreateLabels).length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-[var(--text-100)]">User Management</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-[var(--text-200)]">
          Grant or revoke label creation access for employees. Admins always have full access.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          <svg className="w-4 h-4 shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
          </svg>
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 cursor-pointer">×</button>
        </div>
      )}

      {/* Stats */}
      {!loading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            { label: 'Total users', value: users.length },
            { label: 'Can create labels', value: permittedCount },
            { label: 'Admins', value: adminCount },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-xl border border-[var(--bg-300)] dark:border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-100)] px-4 py-3"
            >
              <p className="text-2xl font-semibold text-slate-900 dark:text-[var(--text-100)]">{s.value}</p>
              <p className="text-xs text-slate-500 dark:text-[var(--text-200)] mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Table card */}
      <section className="rounded-xl border border-[var(--bg-300)] dark:border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-100)] overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-[var(--bg-300)] dark:border-[var(--bg-300)]">
          <h2 className="text-base font-semibold text-slate-900 dark:text-[var(--text-100)]">Employees</h2>
          <input
            type="search"
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded-lg border border-[var(--bg-300)] dark:border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-200)] px-3 py-1.5 text-sm text-slate-700 dark:text-[var(--text-200)] placeholder-slate-400 dark:placeholder-[var(--primary-200)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-200)] w-full sm:w-64"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--bg-200)] dark:bg-[var(--bg-200)] text-slate-500 dark:text-[var(--text-200)] text-xs uppercase tracking-wide">
              <tr className="text-left">
                <th className="px-5 py-3 font-medium">User</th>
                <th className="px-5 py-3 font-medium">Role</th>
                <th className="px-5 py-3 font-medium">Joined</th>
                <th className="px-5 py-3 font-medium text-right">Create Labels</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-[var(--bg-300)]">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-slate-400 dark:text-[var(--text-200)]">
                    Loading users…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-slate-400 dark:text-[var(--text-200)]">
                    {search ? 'No users match your search.' : 'No users found.'}
                  </td>
                </tr>
              ) : (
                filtered.map((u) => (
                  <tr key={u._id} className="hover:bg-[var(--primary-100)] dark:hover:bg-[var(--primary-100)] transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <UserAvatar user={u} />
                        <div className="min-w-0">
                          <p className="font-medium text-slate-800 dark:text-[var(--text-100)] truncate">{u.name}</p>
                          <p className="text-xs text-slate-500 dark:text-[var(--text-200)] truncate">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      {u.role === 'admin' ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 dark:bg-[var(--primary-100)] text-purple-700 dark:text-[var(--accent-200)] px-2 py-0.5 text-xs font-medium">
                          <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M10 1a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 1zM5.05 3.05a.75.75 0 011.06 0l1.062 1.06A.75.75 0 116.11 5.173L5.05 4.11a.75.75 0 010-1.06zm9.9 0a.75.75 0 010 1.06l-1.06 1.062a.75.75 0 01-1.062-1.061l1.061-1.06a.75.75 0 011.06 0zM10 7a3 3 0 100 6 3 3 0 000-6zM3.25 10a.75.75 0 01.75-.75h1.5a.75.75 0 010 1.5H4a.75.75 0 01-.75-.75zm11 0a.75.75 0 01.75-.75H16a.75.75 0 010 1.5h-1a.75.75 0 01-.75-.75zM5.05 15.89a.75.75 0 01.001-1.06l1.06-1.062a.75.75 0 011.062 1.061l-1.061 1.06a.75.75 0 01-1.06.001zm9.9-.001a.75.75 0 01-1.061 0l-1.06-1.062a.75.75 0 011.06-1.061l1.062 1.06a.75.75 0 01-.001 1.063zM10 16.75a.75.75 0 01.75.75v1a.75.75 0 01-1.5 0v-1a.75.75 0 01.75-.75z" clipRule="evenodd" />
                          </svg>
                          Admin
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-[var(--primary-100)] dark:bg-[var(--bg-200)] text-slate-600 dark:text-[var(--text-200)] px-2 py-0.5 text-xs font-medium">
                          User
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-slate-500 dark:text-[var(--text-200)] whitespace-nowrap text-xs">
                      {new Date(u.createdAt).toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-2.5">
                        {u.role === 'admin' ? (
                          <span className="text-xs text-slate-400 dark:text-[var(--text-200)] italic">always on</span>
                        ) : (
                          <>
                            <span className={`text-xs ${u.canCreateLabels ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-[var(--text-200)]'}`}>
                              {u.canCreateLabels ? 'Granted' : 'Denied'}
                            </span>
                            <Toggle
                              checked={u.canCreateLabels}
                              disabled={togglingId === u._id}
                              onChange={(v) => handleToggle(u, v)}
                            />
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
