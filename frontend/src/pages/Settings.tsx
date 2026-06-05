import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { authApi, ApiError } from '../lib/api'
import type { AppSettings, SettingsResponse, DriveFolder, SyncConfigResponse } from '../types/label'
import { useAuth } from '../context/AuthContext'

interface FoldersResponse {
  data: DriveFolder[]
}

interface Crumb {
  id: string
  name: string
  /** Set when this crumb is a Shared Drive root or a folder inside one. */
  driveId?: string
}

/** Extracts a folder ID from a pasted Drive URL, or returns the raw input. */
function extractFolderId(input: string): string {
  const trimmed = input.trim()
  const match = trimmed.match(/folders\/([a-zA-Z0-9_-]+)/)
  return match ? match[1] : trimmed
}

const DRIVE_ERROR_MESSAGES: Record<string, string> = {
  access_denied: 'Google Drive access was denied. Please try again.',
  invalid_state: 'The authorisation request expired. Please try again.',
  user_not_found: 'Your account could not be found. Please refresh and try again.',
  auth_failed: 'Google Drive authorisation failed. Please try again.',
}

const DROPBOX_ERROR_MESSAGES: Record<string, string> = {
  access_denied: 'Dropbox access was denied. Please try again.',
  invalid_state: 'The authorisation request expired. Please try again.',
  user_not_found: 'Your account could not be found. Please refresh and try again.',
  auth_failed: 'Dropbox authorisation failed. Please try again.',
}

export default function Settings() {
  const { user, refreshUser } = useAuth()
  const canCreate = !!user?.canCreateLabels
  const isAdmin = user?.role === 'admin'
  const [searchParams, setSearchParams] = useSearchParams()

  // Auto-sync (admin-only) configuration
  const [syncEnabled, setSyncEnabled] = useState(true)
  const [syncMinutes, setSyncMinutes] = useState('5')
  const [syncLoaded, setSyncLoaded] = useState(false)
  const [syncSaving, setSyncSaving] = useState(false)

  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)

  // Dropbox connection state
  const [dropboxDisconnecting, setDropboxDisconnecting] = useState(false)
  const [dropboxConfirmDisconnect, setDropboxConfirmDisconnect] = useState(false)

  // Folder browser state
  const [crumbs, setCrumbs] = useState<Crumb[]>([])
  const [folders, setFolders] = useState<DriveFolder[]>([])
  const [foldersLoading, setFoldersLoading] = useState(false)
  const [browserOpen, setBrowserOpen] = useState(false)
  const [manualId, setManualId] = useState('')
  const [driveExpired, setDriveExpired] = useState(false)

  const loadSettings = useCallback(async () => {
    try {
      const res = await authApi.get<SettingsResponse>('/settings')
      setSettings(res.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load settings')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  // Load the global auto-sync config (admins only).
  useEffect(() => {
    if (!isAdmin) return
    authApi
      .get<SyncConfigResponse>('/settings/sync')
      .then((res) => {
        setSyncEnabled(res.data.enabled)
        setSyncMinutes(String(Math.max(1, Math.round(res.data.intervalMs / 60000))))
        setSyncLoaded(true)
      })
      .catch(() => setSyncLoaded(true))
  }, [isAdmin])

  const saveSyncConfig = async () => {
    const minutes = Number(syncMinutes)
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) {
      setError('Sync interval must be between 1 and 1440 minutes.')
      return
    }
    setSyncSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await authApi.put<SyncConfigResponse>('/settings/sync', {
        enabled: syncEnabled,
        intervalMs: Math.round(minutes * 60000),
      })
      setSyncEnabled(res.data.enabled)
      setSyncMinutes(String(Math.max(1, Math.round(res.data.intervalMs / 60000))))
      setSuccess(
        res.data.enabled
          ? `Auto-sync enabled — syncing every ${Math.round(res.data.intervalMs / 60000)} min.`
          : 'Auto-sync disabled.'
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save auto-sync settings')
    } finally {
      setSyncSaving(false)
    }
  }

  // Handle redirect-back from the Drive OAuth flow
  useEffect(() => {
    const driveResult = searchParams.get('drive')
    const driveError = searchParams.get('drive_error')
    if (driveResult === 'connected') {
      setSuccess('Google Drive connected successfully.')
      setDriveExpired(false)
      loadSettings()
      refreshUser()
      setSearchParams({}, { replace: true })
    } else if (driveError) {
      setError(DRIVE_ERROR_MESSAGES[driveError] ?? 'Google Drive connection failed.')
      setSearchParams({}, { replace: true })
      return
    }

    const dropboxResult = searchParams.get('dropbox')
    const dropboxError = searchParams.get('dropbox_error')
    if (dropboxResult === 'connected') {
      setSuccess('Dropbox connected successfully.')
      loadSettings()
      setSearchParams({}, { replace: true })
    } else if (dropboxError) {
      setError(DROPBOX_ERROR_MESSAGES[dropboxError] ?? 'Dropbox connection failed.')
      setSearchParams({}, { replace: true })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadFolders = useCallback(async (parentId?: string, driveId?: string) => {
    setFoldersLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams()
      if (parentId) qs.set('parentId', parentId)
      if (driveId) qs.set('driveId', driveId)
      const query = qs.toString() ? `?${qs.toString()}` : ''
      const res = await authApi.get<FoldersResponse>(`/settings/drive/folders${query}`)
      setFolders(res.data)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'drive_token_expired') {
        setDriveExpired(true)
        setBrowserOpen(false)
      }
      setError(e instanceof Error ? e.message : 'Failed to list Drive folders')
      setFolders([])
    } finally {
      setFoldersLoading(false)
    }
  }, [])

  const openBrowser = () => {
    setBrowserOpen(true)
    setCrumbs([])
    loadFolders(undefined, undefined)
  }

  const enterFolder = (folder: DriveFolder) => {
    const currentDriveId = crumbs[crumbs.length - 1]?.driveId
    // A Shared Drive entry becomes the new driveId; its contents are listed
    // using its own ID as both parentId and driveId.
    const nextDriveId = folder.isSharedDrive ? folder.id : currentDriveId
    const crumb: Crumb = { id: folder.id, name: folder.name, driveId: nextDriveId }
    setCrumbs((prev) => [...prev, crumb])
    loadFolders(folder.id, nextDriveId)
  }

  const goToCrumb = (index: number) => {
    if (index < 0) {
      setCrumbs([])
      loadFolders(undefined, undefined)
    } else {
      const next = crumbs.slice(0, index + 1)
      setCrumbs(next)
      const crumb = next[next.length - 1]
      loadFolders(crumb.id, crumb.driveId)
    }
  }

  const saveFolder = async (folderId: string | null) => {
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await authApi.put<SettingsResponse>('/settings', { driveFolderId: folderId })
      setSettings(res.data)
      setBrowserOpen(false)
      setManualId('')
      setSuccess(folderId ? 'Destination folder saved.' : 'Destination folder cleared (uploads go to Drive root).')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save folder')
    } finally {
      setSaving(false)
    }
  }

  const handleDisconnect = async () => {
    if (!confirmDisconnect) {
      setConfirmDisconnect(true)
      return
    }
    setDisconnecting(true)
    setError(null)
    setSuccess(null)
    try {
      await authApi.delete('/settings/drive')
      setSettings((prev) => prev ? { ...prev, driveConnected: false, driveConnectedAt: null, driveAccountEmail: null, driveAccountName: null, driveAccountAvatar: null, driveFolderId: null, driveFolderName: null } : prev)
      setConfirmDisconnect(false)
      setBrowserOpen(false)
      setDriveExpired(false)
      await refreshUser()
      setSuccess('Google Drive disconnected. You can reconnect at any time.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to disconnect Google Drive')
      setConfirmDisconnect(false)
    } finally {
      setDisconnecting(false)
    }
  }

  const connectDropbox = async () => {
    try {
      const res = await authApi.get<{ url: string }>('/auth/dropbox/connect')
      window.location.href = res.url
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start Dropbox authorisation.')
    }
  }

  const handleDropboxDisconnect = async () => {
    if (!dropboxConfirmDisconnect) {
      setDropboxConfirmDisconnect(true)
      return
    }
    setDropboxDisconnecting(true)
    setError(null)
    setSuccess(null)
    try {
      await authApi.delete('/settings/dropbox')
      setSettings((prev) => prev ? { ...prev, dropboxConnected: false, dropboxConnectedAt: null, dropboxAccountEmail: null, dropboxAccountName: null } : prev)
      setDropboxConfirmDisconnect(false)
      setSuccess('Dropbox disconnected. You can reconnect at any time.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to disconnect Dropbox')
      setDropboxConfirmDisconnect(false)
    } finally {
      setDropboxDisconnecting(false)
    }
  }

  const currentFolderId = crumbs.length > 0 ? crumbs[crumbs.length - 1].id : null

  return (
    <div className="max-w-3xl space-y-6">
      {error && (
        <Banner tone="error" onClose={() => setError(null)}>{error}</Banner>
      )}
      {success && (
        <Banner tone="success" onClose={() => setSuccess(null)}>{success}</Banner>
      )}

      {!canCreate && (
        <div className="notice-card notice-card--warning flex items-start gap-3 text-sm">
          <svg className="w-4 h-4 shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
          </svg>
          <span>
            You have <span className="font-medium">view-only</span> access. Contact an admin to get label creation permission.
          </span>
        </div>
      )}

      <section className="rounded-xl border border-[var(--bg-300)] dark:border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-100)] p-5">
        <div className="flex items-start gap-3 mb-4">
          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--bg-300)] dark:border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-200)]">
            <GoogleDriveLogo className="h-6 w-6" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-[var(--text-100)]">Google Drive</h2>
            <p className="text-sm text-slate-500 dark:text-[var(--text-200)]">
              Created shipping-label PDFs (named by PO#) are uploaded to your Google Drive.
            </p>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                  settings?.driveConnected
                    ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                    : 'bg-slate-200 dark:bg-[var(--bg-300)] text-slate-600 dark:text-[var(--text-200)]'
                }`}
              >
                {settings?.driveConnected ? <CheckCircleIcon className="h-3.5 w-3.5" /> : <UnplugIcon className="h-3.5 w-3.5" />}
                {settings?.driveConnected ? 'Connected' : 'Not connected'}
              </span>
              {!settings?.driveConnected && canCreate && (
                <button
                  onClick={async () => {
                    try {
                      const res = await authApi.get<{ url: string }>('/auth/drive/connect')
                      window.location.href = res.url
                    } catch {
                      setError('Failed to start Google Drive authorisation.')
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-200)] dark:bg-[var(--accent-100)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 transition-colors cursor-pointer"
                >
                  <GoogleDriveLogo className="h-4 w-4" mono />
                  Connect Google Drive
                </button>
              )}
              {settings?.driveConnected && canCreate && (
                confirmDisconnect ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-red-600 dark:text-red-400 whitespace-nowrap">Disconnect Drive?</span>
                    <button
                      onClick={handleDisconnect}
                      disabled={disconnecting}
                      className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60 transition-colors cursor-pointer"
                    >
                      {disconnecting ? 'Disconnecting…' : 'Confirm'}
                    </button>
                    <button
                      onClick={() => setConfirmDisconnect(false)}
                      className="text-xs text-slate-500 dark:text-[var(--text-200)] hover:text-slate-700 dark:hover:text-[var(--text-100)] cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={handleDisconnect}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-900/15 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors cursor-pointer"
                  >
                    <UnplugIcon className="h-3.5 w-3.5" />
                    Disconnect
                  </button>
                )
              )}
            </div>

            {settings?.driveConnected && (
              <>
                <div className="rounded-lg border border-[var(--bg-300)] dark:border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-200)] divide-y divide-[var(--bg-300)] dark:divide-[var(--bg-300)] mb-4">
                  {/* Connected account row */}
                  <div className="flex items-center gap-3 p-4">
                    {settings.driveAccountAvatar ? (
                      <img
                        src={settings.driveAccountAvatar}
                        alt={settings.driveAccountName || ''}
                        className="h-9 w-9 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-200 dark:bg-[var(--bg-300)] text-slate-500 dark:text-[var(--text-200)] text-sm font-medium">
                        {(settings.driveAccountName || '?')[0].toUpperCase()}
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-[var(--text-200)] mb-0.5">Connected account</p>
                      <p className="text-sm font-medium text-slate-800 dark:text-[var(--text-100)] truncate">{settings.driveAccountName}</p>
                      <p className="text-xs text-slate-500 dark:text-[var(--text-200)] truncate">{settings.driveAccountEmail}</p>
                      {canCreate && (
                        <button
                          onClick={async () => {
                            try {
                              const res = await authApi.get<{ url: string }>('/auth/drive/connect')
                              window.location.href = res.url
                            } catch {
                              setError('Failed to start Google Drive authorisation.')
                            }
                          }}
                          className="mt-1 inline-flex items-center gap-1 text-xs text-[var(--accent-100)] dark:text-[var(--accent-200)] hover:underline cursor-pointer"
                        >
                          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
                          Switch account
                        </button>
                      )}
                    </div>
                    {settings.driveConnectedAt && (
                      <div className="ml-auto shrink-0 text-right">
                        <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-[var(--text-200)] mb-0.5">Connected on</p>
                        <p className="text-xs font-medium text-slate-600 dark:text-[var(--text-200)] whitespace-nowrap">
                          {new Date(settings.driveConnectedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                        </p>
                        <p className="text-xs text-slate-400 dark:text-[var(--text-200)] whitespace-nowrap">
                          {new Date(settings.driveConnectedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Destination folder row */}
                  <div className="flex items-start gap-3 p-4">
                    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
                      <FolderIcon className="h-5 w-5 text-amber-500" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-[var(--text-200)] mb-0.5">Destination folder</p>
                      <p className="text-sm font-medium text-slate-800 dark:text-[var(--text-100)] break-words">
                        {settings.driveFolderName || 'My Drive (root)'}
                      </p>
                      {settings.driveFolderId && (
                        <p className="inline-flex items-center gap-1 text-xs text-slate-400 dark:text-[var(--text-200)] font-mono mt-1 break-all">
                          <HashIcon className="h-3 w-3 shrink-0" />
                          {settings.driveFolderId}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {driveExpired && canCreate && (
                  <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-900/15 px-4 py-3">
                    <svg className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                    </svg>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Drive access revoked or expired</p>
                      <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                        Google has revoked this connection. Reconnect to browse folders and upload labels.
                      </p>
                    </div>
                    <button
                      onClick={async () => {
                        try {
                          const res = await authApi.get<{ url: string }>('/auth/drive/connect')
                          window.location.href = res.url
                        } catch {
                          setError('Failed to start Google Drive authorisation.')
                        }
                      }}
                      className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 px-3 py-1.5 text-xs font-medium text-white transition-colors cursor-pointer"
                    >
                      <GoogleDriveLogo className="h-3.5 w-3.5" mono />
                      Reconnect
                    </button>
                  </div>
                )}

                {canCreate && (
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      onClick={openBrowser}
                      disabled={driveExpired}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--bg-300)] dark:border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-200)] px-3 py-2 text-sm font-medium text-slate-700 dark:text-[var(--text-200)] hover:bg-[var(--primary-100)] dark:hover:bg-[var(--primary-100)] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <FolderSearchIcon className="h-4 w-4" />
                      Browse folders
                    </button>
                    {settings.driveFolderId && (
                      <button
                        onClick={() => saveFolder(null)}
                        disabled={saving}
                        className="text-sm text-slate-500 dark:text-[var(--text-200)] hover:text-slate-700 dark:hover:text-[var(--text-100)] disabled:opacity-50 cursor-pointer"
                      >
                        Reset to root
                      </button>
                    )}
                  </div>
                )}

                {/* Manual folder ID / URL */}
                {canCreate && (
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={manualId}
                      onChange={(e) => setManualId(e.target.value)}
                      placeholder="Or paste a Drive folder URL / ID"
                      className="flex-1 min-w-[240px] rounded-lg border border-[var(--bg-300)] dark:border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-200)] px-3 py-2 text-sm text-slate-700 dark:text-[var(--text-200)] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--accent-200)]"
                    />
                    <button
                      onClick={() => saveFolder(extractFolderId(manualId))}
                      disabled={saving || !manualId.trim()}
                      className="rounded-lg bg-[var(--accent-200)] dark:bg-[var(--accent-100)] px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
                    >
                      Save
                    </button>
                  </div>
                )}

                {/* Folder browser */}
                {canCreate && browserOpen && (
                  <div className="mt-4 rounded-lg border border-[var(--bg-300)] dark:border-[var(--bg-300)] overflow-hidden">
                    <div className="flex items-center gap-1 flex-wrap px-3 py-2 bg-[var(--bg-200)] dark:bg-[var(--bg-200)] text-sm">
                      <button onClick={() => goToCrumb(-1)} className="inline-flex items-center gap-1 text-[var(--accent-100)] dark:text-[var(--accent-200)] hover:underline cursor-pointer">
                        <GoogleDriveLogo className="h-3.5 w-3.5" />
                        My Drive
                      </button>
                      {crumbs.map((c, i) => (
                        <span key={c.id} className="flex items-center gap-1">
                          <span className="text-slate-400">/</span>
                          <button onClick={() => goToCrumb(i)} className="text-[var(--accent-100)] dark:text-[var(--accent-200)] hover:underline cursor-pointer">{c.name}</button>
                        </span>
                      ))}
                    </div>

                    <div className="max-h-64 overflow-y-auto divide-y divide-[var(--bg-300)] dark:divide-[var(--bg-300)]">
                      {foldersLoading ? (
                        <p className="px-3 py-3 text-sm text-slate-400">Loading folders…</p>
                      ) : folders.length === 0 ? (
                        <p className="px-3 py-3 text-sm text-slate-400">No subfolders here.</p>
                      ) : (
                        folders.map((f) => (
                          <button
                            key={f.id}
                            onClick={() => enterFolder(f)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 dark:text-[var(--text-200)] hover:bg-[var(--primary-100)] dark:hover:bg-[var(--primary-100)] cursor-pointer"
                          >
                            {f.isSharedDrive ? (
                              <GoogleDriveLogo className="h-4 w-4 shrink-0" />
                            ) : (
                              <svg className="h-4 w-4 text-amber-500 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path d="M2 5a2 2 0 012-2h4l2 2h6a2 2 0 012 2v7a2 2 0 01-2 2H4a2 2 0 01-2-2V5z" /></svg>
                            )}
                            <span className="truncate">{f.name}</span>
                            {f.isSharedDrive && (
                              <span className="ml-auto shrink-0 text-xs text-slate-400 dark:text-[var(--text-200)]">Shared drive</span>
                            )}
                          </button>
                        ))
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-t border-[var(--bg-300)] dark:border-[var(--bg-300)] bg-[var(--bg-200)] dark:bg-[var(--bg-100)]">
                      <span className="inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-[var(--text-200)] min-w-0">
                        <FolderIcon className="h-4 w-4 shrink-0 text-amber-500" />
                        <span className="truncate">
                          {currentFolderId ? `Current: ${crumbs[crumbs.length - 1].name}` : 'Current: My Drive (root)'}
                        </span>
                      </span>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setBrowserOpen(false)} className="text-sm text-slate-500 dark:text-[var(--text-200)] hover:text-slate-700 dark:hover:text-[var(--text-100)] cursor-pointer">Cancel</button>
                        <button
                          onClick={() => saveFolder(currentFolderId ?? 'root')}
                          disabled={saving}
                          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors cursor-pointer"
                        >
                          Use this folder
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            {!settings?.driveConnected && (
              <p className="text-xs text-slate-400 dark:text-[var(--text-200)]">
                Connecting re-authenticates with Google and grants Drive access so labels can be saved to your Drive.
              </p>
            )}
          </>
        )}
      </section>

      {/* Dropbox connection — powers the Dropbox Fetcher page */}
      <section className="rounded-xl border border-[var(--bg-300)] dark:border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-100)] p-5">
        <div className="flex items-start gap-3 mb-4">
          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--bg-300)] dark:border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-200)]">
            <DropboxLogo className="h-6 w-6" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-[var(--text-100)]">Dropbox</h2>
            <p className="text-sm text-slate-500 dark:text-[var(--text-200)]">
              Connect your Dropbox to use the Dropbox Fetcher — browse folders and extract shareable links for files.
            </p>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                  settings?.dropboxConnected
                    ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                    : 'bg-slate-200 dark:bg-[var(--bg-300)] text-slate-600 dark:text-[var(--text-200)]'
                }`}
              >
                {settings?.dropboxConnected ? <CheckCircleIcon className="h-3.5 w-3.5" /> : <UnplugIcon className="h-3.5 w-3.5" />}
                {settings?.dropboxConnected ? 'Connected' : 'Not connected'}
              </span>
              {!settings?.dropboxConnected && (
                <button
                  onClick={connectDropbox}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#0061FF] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 transition-colors cursor-pointer"
                >
                  <DropboxLogo className="h-4 w-4" mono />
                  Connect Dropbox
                </button>
              )}
              {settings?.dropboxConnected && (
                dropboxConfirmDisconnect ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-red-600 dark:text-red-400 whitespace-nowrap">Disconnect Dropbox?</span>
                    <button
                      onClick={handleDropboxDisconnect}
                      disabled={dropboxDisconnecting}
                      className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60 transition-colors cursor-pointer"
                    >
                      {dropboxDisconnecting ? 'Disconnecting…' : 'Confirm'}
                    </button>
                    <button
                      onClick={() => setDropboxConfirmDisconnect(false)}
                      className="text-xs text-slate-500 dark:text-[var(--text-200)] hover:text-slate-700 dark:hover:text-[var(--text-100)] cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={handleDropboxDisconnect}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-900/15 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors cursor-pointer"
                  >
                    <UnplugIcon className="h-3.5 w-3.5" />
                    Disconnect
                  </button>
                )
              )}
            </div>

            {settings?.dropboxConnected ? (
              <div className="rounded-lg border border-[var(--bg-300)] dark:border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-200)]">
                <div className="flex items-center gap-3 p-4">
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#0061FF]/10 dark:bg-[#0061FF]/20">
                    <DropboxLogo className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-[var(--text-200)] mb-0.5">Connected account</p>
                    <p className="text-sm font-medium text-slate-800 dark:text-[var(--text-100)] truncate">{settings.dropboxAccountName || 'Dropbox account'}</p>
                    {settings.dropboxAccountEmail && (
                      <p className="text-xs text-slate-500 dark:text-[var(--text-200)] truncate">{settings.dropboxAccountEmail}</p>
                    )}
                    <button
                      onClick={connectDropbox}
                      className="mt-1 inline-flex items-center gap-1 text-xs text-[var(--accent-100)] dark:text-[var(--accent-200)] hover:underline cursor-pointer"
                    >
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
                      Switch account
                    </button>
                  </div>
                  {settings.dropboxConnectedAt && (
                    <div className="ml-auto shrink-0 text-right">
                      <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-[var(--text-200)] mb-0.5">Connected on</p>
                      <p className="text-xs font-medium text-slate-600 dark:text-[var(--text-200)] whitespace-nowrap">
                        {new Date(settings.dropboxConnectedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                      </p>
                      <p className="text-xs text-slate-400 dark:text-[var(--text-200)] whitespace-nowrap">
                        {new Date(settings.dropboxConnectedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400 dark:text-[var(--text-200)]">
                Connecting authorises Ship Queue to read your Dropbox folders and create shareable file links on your behalf.
              </p>
            )}
          </>
        )}
      </section>

      {isAdmin && (
        <section className="rounded-xl border border-[var(--bg-300)] dark:border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-100)] p-5">
          <div className="flex items-start gap-3 mb-4">
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--bg-300)] dark:border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-200)]">
              <SyncIcon className="h-6 w-6 text-[var(--accent-100)] dark:text-[var(--accent-200)]" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-[var(--text-100)]">Automatic order syncing</h2>
              <p className="text-sm text-slate-500 dark:text-[var(--text-200)]">
                Pull new ShipStation orders on the server on a schedule — runs even when nobody has the app open.
              </p>
            </div>
          </div>

          {!syncLoaded ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : (
            <div className="rounded-lg border border-[var(--bg-300)] dark:border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-200)] divide-y divide-[var(--bg-300)] dark:divide-[var(--bg-300)]">
              {/* Enable toggle */}
              <div className="flex items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-800 dark:text-[var(--text-100)]">Background auto-sync</p>
                  <p className="text-xs text-slate-500 dark:text-[var(--text-200)]">
                    When on, the server keeps orders up to date automatically.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={syncEnabled}
                  onClick={() => setSyncEnabled((v) => !v)}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                    syncEnabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-[var(--bg-300)]'
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                      syncEnabled ? 'translate-x-5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>

              {/* Interval */}
              <div className="flex items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-800 dark:text-[var(--text-100)]">Sync interval</p>
                  <p className="text-xs text-slate-500 dark:text-[var(--text-200)]">
                    How often the server checks for new orders (1–1440 minutes).
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    value={syncMinutes}
                    onChange={(e) => setSyncMinutes(e.target.value)}
                    disabled={!syncEnabled}
                    className="w-20 rounded-lg border border-[var(--bg-300)] dark:border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-100)] px-3 py-2 text-sm text-slate-700 dark:text-[var(--text-100)] text-right focus:outline-none focus:ring-2 focus:ring-[var(--accent-200)] disabled:opacity-50"
                  />
                  <span className="text-sm text-slate-500 dark:text-[var(--text-200)]">min</span>
                </div>
              </div>

              {/* Save */}
              <div className="flex items-center justify-end gap-2 p-4">
                <button
                  onClick={saveSyncConfig}
                  disabled={syncSaving}
                  className="rounded-lg bg-[var(--accent-200)] dark:bg-[var(--accent-100)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
                >
                  {syncSaving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  )
}

/** Official multi-color Google Drive logo. Pass `mono` for a single-color version. */
function GoogleDriveLogo({ className = '', mono = false }: { className?: string; mono?: boolean }) {
  if (mono) {
    return (
      <svg className={className} viewBox="0 0 87.3 78" fill="currentColor" aria-hidden="true">
        <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5z" />
        <path d="M43.65 25L29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44C.4 49.9 0 51.45 0 53h27.5z" />
        <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.798l5.852 11.5z" />
        <path d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z" />
        <path d="M59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" />
        <path d="M73.4 26.5l-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25 59.8 53h27.45c0-1.55-.4-3.1-1.2-4.5z" />
      </svg>
    )
  }
  return (
    <svg className={className} viewBox="0 0 87.3 78" aria-hidden="true">
      <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da" />
      <path d="M43.65 25L29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44C.4 49.9 0 51.45 0 53h27.5z" fill="#00ac47" />
      <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.798l5.852 11.5z" fill="#ea4335" />
      <path d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d" />
      <path d="M59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc" />
      <path d="M73.4 26.5l-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25 59.8 53h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00" />
    </svg>
  )
}

/** Dropbox logo. Pass `mono` for a single-color (white) version on colored buttons. */
function DropboxLogo({ className = '', mono = false }: { className?: string; mono?: boolean }) {
  const fill = mono ? 'currentColor' : '#0061FF'
  return (
    <svg className={className} viewBox="0 0 24 24" fill={fill} aria-hidden="true">
      <path d="M6 2 0 5.9l6 3.9 6-3.9L6 2Zm12 0-6 3.9 6 3.9 6-3.9L18 2ZM0 13.7l6 3.9 6-3.9-6-3.9-6 3.9Zm18-3.9-6 3.9 6 3.9 6-3.9-6-3.9ZM6 18.9l6 3.9 6-3.9-6-3.9-6 3.9Z" />
    </svg>
  )
}

function FolderIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M2 5a2 2 0 012-2h4l2 2h6a2 2 0 012 2v7a2 2 0 01-2 2H4a2 2 0 01-2-2V5z" />
    </svg>
  )
}

function FolderSearchIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v3.5M3 7v10a2 2 0 002 2h6" />
      <circle cx="17" cy="17" r="3" strokeWidth={2} />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.5 19.5L22 22" />
    </svg>
  )
}

function CheckCircleIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

function UnplugIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.36 6.64a9 9 0 11-12.73 0M12 2v10" />
    </svg>
  )
}

function SyncIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  )
}

function HashIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4l-2 16M17 4l-2 16M4 9h16M3 15h16" />
    </svg>
  )
}

function Banner({ tone, children, onClose }: { tone: 'error' | 'success'; children: React.ReactNode; onClose: () => void }) {
  const styles =
    tone === 'error'
      ? 'notice-card notice-card--error'
      : 'notice-card notice-card--success'
  const closeStyles =
    tone === 'error'
      ? 'text-red-700/70 hover:bg-red-100 hover:text-red-900 dark:text-red-300 dark:hover:bg-red-900/40'
      : 'text-emerald-700/70 hover:bg-emerald-100 hover:text-emerald-900 dark:text-emerald-300 dark:hover:bg-emerald-900/40'
  return (
    <div className={`flex items-start gap-2 text-sm ${styles}`}>
      <span className="flex-1">{children}</span>
      <button onClick={onClose} className={`rounded-md p-0.5 transition-colors cursor-pointer ${closeStyles}`}>×</button>
    </div>
  )
}
