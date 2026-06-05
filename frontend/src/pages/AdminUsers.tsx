import { useState, useEffect, useCallback, useMemo } from 'react'
import { authApi } from '../lib/api'
import { useAuth } from '../context/AuthContext'

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
        className="w-6 h-6 rounded-full object-cover shrink-0"
      />
    )
  }
  return (
    <span className="w-6 h-6 rounded-full bg-slate-200 dark:bg-[var(--bg-300)] text-slate-600 dark:text-[var(--text-200)] text-xs font-semibold flex items-center justify-center shrink-0 select-none">
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

function ConfirmDeleteModal({
  user,
  onConfirm,
  onCancel,
  deleting,
}: {
  user: ManagedUser
  onConfirm: () => void
  onCancel: () => void
  deleting: boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/15 backdrop-blur-[2px]" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-sm rounded-xl border border-[var(--bg-300)] bg-[var(--bg-100)] shadow-xl p-6 space-y-4">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
            <svg className="w-5 h-5 text-red-600 dark:text-red-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" />
            </svg>
          </span>
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-[var(--text-100)]">Remove user?</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-[var(--text-200)]">
              <span className="font-medium text-slate-700 dark:text-[var(--text-100)]">{user.name}</span> ({user.email}) will be permanently removed and will need to log in again to regain access.
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={deleting}
            className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-600 dark:text-[var(--text-200)] bg-[var(--bg-200)] hover:bg-[var(--bg-300)] transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            className="rounded-lg px-3.5 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 transition-colors cursor-pointer disabled:opacity-60 flex items-center gap-2"
          >
            {deleting && (
              <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            )}
            Remove user
          </button>
        </div>
      </div>
    </div>
  )
}

function ConfirmRoleModal({
  user,
  newRole,
  onConfirm,
  onCancel,
  saving,
}: {
  user: ManagedUser
  newRole: 'admin' | 'user'
  onConfirm: () => void
  onCancel: () => void
  saving: boolean
}) {
  const promoting = newRole === 'admin'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/15 backdrop-blur-[2px]" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-sm rounded-xl border border-[var(--bg-300)] bg-[var(--bg-100)] shadow-xl p-6 space-y-4">
        <div className="flex items-start gap-3">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${promoting ? 'bg-purple-100 dark:bg-purple-900/30' : 'bg-amber-100 dark:bg-amber-900/30'}`}>
            <svg className={`w-5 h-5 ${promoting ? 'text-purple-600 dark:text-purple-400' : 'text-amber-600 dark:text-amber-400'}`} viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 1a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 1zM10 7a3 3 0 100 6 3 3 0 000-6zM3.25 10a.75.75 0 01.75-.75h1.5a.75.75 0 010 1.5H4a.75.75 0 01-.75-.75zm11 0a.75.75 0 01.75-.75H16a.75.75 0 010 1.5h-1a.75.75 0 01-.75-.75zM10 16.75a.75.75 0 01.75.75v1a.75.75 0 01-1.5 0v-1a.75.75 0 01.75-.75z" clipRule="evenodd" />
            </svg>
          </span>
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-[var(--text-100)]">
              {promoting ? 'Upgrade to Admin?' : 'Downgrade to User?'}
            </h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-[var(--text-200)]">
              <span className="font-medium text-slate-700 dark:text-[var(--text-100)]">{user.name}</span> ({user.email}){' '}
              {promoting
                ? 'will gain full admin access, including managing users and creating labels.'
                : 'will lose admin access and become a regular user.'}
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={saving}
            className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-600 dark:text-[var(--text-200)] bg-[var(--bg-200)] hover:bg-[var(--bg-300)] transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={saving}
            className={`rounded-lg px-3.5 py-2 text-sm font-medium text-white transition-colors cursor-pointer disabled:opacity-60 flex items-center gap-2 ${promoting ? 'bg-purple-600 hover:bg-purple-700' : 'bg-amber-600 hover:bg-amber-700'}`}
          >
            {saving && (
              <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            )}
            {promoting ? 'Make Admin' : 'Make User'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function AdminUsers() {
  const { user: currentUser } = useAuth()
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<ManagedUser | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmRole, setConfirmRole] = useState<{ user: ManagedUser; newRole: 'admin' | 'user' } | null>(null)
  const [changingRoleId, setChangingRoleId] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(10)

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

  const handleRoleChange = async (user: ManagedUser, newRole: 'admin' | 'user') => {
    setChangingRoleId(user._id)
    setError(null)
    try {
      const res = await authApi.patch<{ data: ManagedUser }>(`/admin/users/${user._id}/role`, {
        role: newRole,
      })
      setUsers((prev) => prev.map((u) => (u._id === user._id ? { ...u, ...res.data } : u)))
      setConfirmRole(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update role')
      setConfirmRole(null)
    } finally {
      setChangingRoleId(null)
    }
  }

  const handleDelete = async (user: ManagedUser) => {
    setDeletingId(user._id)
    setError(null)
    try {
      await authApi.delete(`/admin/users/${user._id}`)
      setUsers((prev) => prev.filter((u) => u._id !== user._id))
      setConfirmDelete(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete user')
      setConfirmDelete(null)
    } finally {
      setDeletingId(null)
    }
  }

  const filtered = useMemo(
    () =>
      users.filter(
        (u) =>
          u.name.toLowerCase().includes(search.toLowerCase()) ||
          u.email.toLowerCase().includes(search.toLowerCase()),
      ),
    [users, search],
  )

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount - 1)

  const paginated = useMemo(
    () => filtered.slice(safePage * pageSize, safePage * pageSize + pageSize),
    [filtered, safePage, pageSize],
  )

  const adminCount = users.filter((u) => u.role === 'admin').length
  const permittedCount = users.filter((u) => u.canCreateLabels).length

  return (
    <div className="space-y-6">
      {confirmDelete && (
        <ConfirmDeleteModal
          user={confirmDelete}
          onConfirm={() => handleDelete(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
          deleting={deletingId === confirmDelete._id}
        />
      )}
      {confirmRole && (
        <ConfirmRoleModal
          user={confirmRole.user}
          newRole={confirmRole.newRole}
          onConfirm={() => handleRoleChange(confirmRole.user, confirmRole.newRole)}
          onCancel={() => setConfirmRole(null)}
          saving={changingRoleId === confirmRole.user._id}
        />
      )}
      {/* Header */}
      <div>
        {/* <h1 className="text-xl font-semibold text-slate-900 dark:text-[var(--text-100)]">User Management</h1> */}
        <p className="mt-1 text-sm text-slate-500 dark:text-[var(--text-200)]">
          Grant or revoke label creation access for employees. Admins always have full access.
        </p>
      </div>

      {error && (
        <div className="notice-card notice-card--error flex items-start gap-2 text-sm">
          <svg className="w-4 h-4 shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
          </svg>
          <span className="flex-1">{error}</span>
          <button
            onClick={() => setError(null)}
            className="rounded-md p-0.5 text-red-700/70 hover:bg-red-100 hover:text-red-900 dark:text-red-300 dark:hover:bg-red-900/40 transition-colors cursor-pointer"
          >
            ×
          </button>
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
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(0)
            }}
            className="rounded-lg border border-[var(--bg-300)] dark:border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-200)] px-3 py-1.5 text-sm text-slate-700 dark:text-[var(--text-200)] placeholder-slate-400 dark:placeholder-[var(--primary-200)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-200)] w-full sm:w-64"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--bg-200)] dark:bg-[var(--bg-200)] text-slate-500 dark:text-[var(--text-200)] text-xs uppercase tracking-wide">
              <tr className="text-left">
                <th className="px-4 py-2 font-medium">User</th>
                <th className="px-4 py-2 font-medium">Role</th>
                <th className="px-4 py-2 font-medium">Joined</th>
                <th className="px-4 py-2 font-medium text-right">Create Labels</th>
                <th className="px-4 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-[var(--bg-300)]">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-400 dark:text-[var(--text-200)]">
                    Loading users…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-400 dark:text-[var(--text-200)]">
                    {search ? 'No users match your search.' : 'No users found.'}
                  </td>
                </tr>
              ) : (
                paginated.map((u, rowIndex) => {
                  const isEvenRow = rowIndex % 2 === 0
                  const rowStripedClass = isEvenRow
                    ? 'bg-[var(--bg-100)] dark:bg-[var(--bg-100)]'
                    : 'bg-[var(--bg-200)] dark:bg-[var(--bg-200)]'
                  const isSelf = currentUser?.id === u._id
                  return (
                  <tr key={u._id} className={`${rowStripedClass} hover:bg-[var(--primary-100)] dark:hover:bg-[var(--primary-100)] transition-colors`}>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <UserAvatar user={u} />
                        <div className="min-w-0">
                          <p className="font-medium text-slate-800 dark:text-[var(--text-100)] truncate">{u.name}</p>
                          <p className="text-xs text-slate-500 dark:text-[var(--text-200)] truncate">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
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
                        {isSelf ? (
                          <span className="text-[11px] text-slate-400 dark:text-[var(--text-200)] italic">you</span>
                        ) : (
                          <select
                            aria-label={`Change role for ${u.name}`}
                            value={u.role}
                            disabled={changingRoleId === u._id}
                            onChange={(e) => {
                              const newRole = e.target.value as 'admin' | 'user'
                              if (newRole !== u.role) setConfirmRole({ user: u, newRole })
                            }}
                            className="rounded-lg border border-[var(--bg-300)] dark:border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-200)] px-2 py-1 text-xs text-slate-600 dark:text-[var(--text-200)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-200)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <option value="user">User</option>
                            <option value="admin">Admin</option>
                          </select>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-slate-500 dark:text-[var(--text-200)] whitespace-nowrap text-xs">
                      <span className="block text-slate-600 dark:text-[var(--text-100)]">
                        {new Date(u.createdAt).toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </span>
                      <span className="block text-[11px] text-slate-400 dark:text-[var(--text-200)]">
                        {new Date(u.createdAt).toLocaleTimeString(undefined, {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-2">
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
                    <td className="px-4 py-2 text-right">
                      {u.role !== 'admin' && (
                        <button
                          onClick={() => setConfirmDelete(u)}
                          disabled={deletingId === u._id || togglingId === u._id}
                          title="Remove user"
                          className="inline-flex items-center justify-center rounded-lg p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 dark:hover:text-red-400 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" />
                          </svg>
                        </button>
                      )}
                    </td>
                  </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination bar */}
        {!loading && filtered.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--bg-300)] dark:border-[var(--bg-300)] bg-[var(--bg-200)] dark:bg-transparent px-5 py-3">
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-[var(--text-200)]">
              <span>Rows per page:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value))
                  setPage(0)
                }}
                className="rounded border border-[var(--bg-300)] dark:border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-200)] px-2 py-1 text-xs text-slate-700 dark:text-[var(--text-200)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-200)] cursor-pointer"
              >
                {[10, 25, 50].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-[var(--text-200)]">
              <span>
                {safePage * pageSize + 1}–{Math.min((safePage + 1) * pageSize, filtered.length)} of {filtered.length}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(Math.max(0, safePage - 1))}
                  disabled={safePage === 0}
                  className="inline-flex items-center justify-center rounded border border-[var(--bg-300)] dark:border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-200)] p-1 text-slate-600 dark:text-[var(--text-200)] hover:bg-[var(--primary-100)] dark:hover:bg-[var(--primary-100)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                  aria-label="Previous page"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                </button>
                <button
                  onClick={() => setPage(safePage + 1)}
                  disabled={(safePage + 1) * pageSize >= filtered.length}
                  className="inline-flex items-center justify-center rounded border border-[var(--bg-300)] dark:border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-200)] p-1 text-slate-600 dark:text-[var(--text-200)] hover:bg-[var(--primary-100)] dark:hover:bg-[var(--primary-100)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                  aria-label="Next page"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
