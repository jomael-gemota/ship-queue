import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { authApi, ApiError } from '../../lib/api'
import type { DriveFolder } from '../../types/label'
import type { DocTidyConfig } from '../../types/docTidy'
import { Spinner } from './docTidyUi'

const ERROR_MESSAGES: Record<string, string> = {
  access_denied: 'Mailbox access was denied. Please try again.',
  invalid_state: 'The authorisation request expired. Please try again.',
  no_refresh_token:
    'Google did not return a refresh token. Remove Ship Queue from the account\u2019s third-party access and connect again.',
  auth_failed: 'Mailbox authorisation failed. Please try again.',
}

interface Crumb {
  id: string
  name: string
  /** Set when this crumb is a Shared Drive root or a folder inside one. */
  driveId?: string
}

/**
 * Settings card for the shared Doc Tidy mailbox. Unlike the Drive card this is
 * app-wide rather than per-user, so only admins can change it.
 */
export default function DocTidySettingsCard({ isAdmin }: { isAdmin: boolean }) {
  const [searchParams, setSearchParams] = useSearchParams()

  const [config, setConfig] = useState<DocTidyConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [saving, setSaving] = useState(false)

  // Folder browser
  const [browserOpen, setBrowserOpen] = useState(false)
  const [crumbs, setCrumbs] = useState<Crumb[]>([])
  const [folders, setFolders] = useState<DriveFolder[]>([])
  const [foldersLoading, setFoldersLoading] = useState(false)

  const loadConfig = useCallback(async () => {
    try {
      const res = await authApi.get<{ data: DocTidyConfig }>('/doc-tidy/config')
      setConfig(res.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load Doc Tidy configuration')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  // Handle the redirect back from the mailbox OAuth flow.
  useEffect(() => {
    const result = searchParams.get('doc_tidy')
    const failure = searchParams.get('doc_tidy_error')

    if (result === 'connected') {
      setSuccess('Doc Tidy mailbox connected.')
      loadConfig()
      setSearchParams({}, { replace: true })
    } else if (failure) {
      setError(ERROR_MESSAGES[failure] ?? 'Mailbox connection failed.')
      setSearchParams({}, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const connect = async () => {
    try {
      const res = await authApi.get<{ url: string }>('/auth/doc-tidy/connect')
      window.location.href = res.url
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start mailbox authorisation.')
    }
  }

  const disconnect = async () => {
    if (!confirmDisconnect) {
      setConfirmDisconnect(true)
      return
    }
    setDisconnecting(true)
    setError(null)
    try {
      await authApi.delete('/doc-tidy/config/mailbox')
      setConfirmDisconnect(false)
      setBrowserOpen(false)
      setSuccess('Doc Tidy mailbox disconnected.')
      await loadConfig()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to disconnect the mailbox')
      setConfirmDisconnect(false)
    } finally {
      setDisconnecting(false)
    }
  }

  const loadFolders = useCallback(async (parentId?: string, driveId?: string) => {
    setFoldersLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams()
      if (parentId) qs.set('parentId', parentId)
      if (driveId) qs.set('driveId', driveId)
      const query = qs.toString() ? `?${qs.toString()}` : ''
      const res = await authApi.get<{ data: DriveFolder[] }>(`/doc-tidy/config/folders${query}`)
      setFolders(res.data)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'doc_tidy_token_expired') setBrowserOpen(false)
      setError(e instanceof Error ? e.message : 'Failed to list Drive folders')
      setFolders([])
    } finally {
      setFoldersLoading(false)
    }
  }, [])

  const openBrowser = () => {
    setBrowserOpen(true)
    setCrumbs([])
    loadFolders()
  }

  const enterFolder = (folder: DriveFolder) => {
    const currentDriveId = crumbs[crumbs.length - 1]?.driveId
    // A Shared Drive entry becomes the new driveId; its contents are listed
    // using its own ID as both parentId and driveId.
    const nextDriveId = folder.isSharedDrive ? folder.id : currentDriveId
    setCrumbs((prev) => [...prev, { id: folder.id, name: folder.name, driveId: nextDriveId }])
    loadFolders(folder.id, nextDriveId)
  }

  const goToCrumb = (index: number) => {
    if (index < 0) {
      setCrumbs([])
      loadFolders()
      return
    }
    const next = crumbs.slice(0, index + 1)
    setCrumbs(next)
    const crumb = next[next.length - 1]
    loadFolders(crumb.id, crumb.driveId)
  }

  const saveFolder = async (folderId: string | null) => {
    setSaving(true)
    setError(null)
    try {
      const driveId = crumbs[crumbs.length - 1]?.driveId
      const res = await authApi.put<{ data: DocTidyConfig }>('/doc-tidy/config', {
        driveFolderId: folderId,
        driveId,
      })
      setConfig(res.data)
      setBrowserOpen(false)
      setSuccess(
        folderId ? 'Attachment destination saved.' : 'Destination cleared — attachments go to the mailbox Drive root.'
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save the destination folder')
    } finally {
      setSaving(false)
    }
  }

  const currentFolderId = crumbs.length > 0 ? crumbs[crumbs.length - 1].id : null

  return (
    <section className="rounded-xl border border-[var(--bg-300)] bg-[var(--bg-100)] p-5">
      <div className="flex items-start gap-3 mb-4">
        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-200)]">
          <svg className="h-6 w-6 text-[var(--accent-200)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.8}
              d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
            />
          </svg>
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-semibold text-slate-900 dark:text-[var(--text-100)]">Doc Tidy mailbox</h2>
            {!isAdmin && (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 dark:bg-[var(--bg-300)] px-2 py-0.5 text-xs font-medium text-slate-600 dark:text-[var(--text-200)]">
                Read-only
              </span>
            )}
          </div>
          <p className="text-sm text-slate-500 dark:text-[var(--text-200)]">
            The shared mailbox that Doc Tidy rules read from, and the Drive folder that extracted
            attachments are copied into. This is app-wide — everyone shares one connection.
          </p>
        </div>
      </div>

      {error && (
        <div className="notice-card notice-card--error mb-3 flex items-start gap-2 text-sm">
          <span className="min-w-0 flex-1">{error}</span>
          <button onClick={() => setError(null)} className="cursor-pointer opacity-70 hover:opacity-100">
            ✕
          </button>
        </div>
      )}
      {success && (
        <div className="notice-card notice-card--success mb-3 flex items-start gap-2 text-sm">
          <span className="min-w-0 flex-1">{success}</span>
          <button onClick={() => setSuccess(null)} className="cursor-pointer opacity-70 hover:opacity-100">
            ✕
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                config?.mailboxConnected
                  ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                  : 'bg-slate-200 dark:bg-[var(--bg-300)] text-slate-600 dark:text-[var(--text-200)]'
              }`}
            >
              {config?.mailboxConnected ? 'Connected' : 'Not connected'}
            </span>

            {isAdmin && !config?.mailboxConnected && (
              <button
                onClick={connect}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-200)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 transition-colors cursor-pointer"
              >
                Connect mailbox
              </button>
            )}

            {isAdmin &&
              config?.mailboxConnected &&
              (confirmDisconnect ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-red-600 dark:text-red-400 whitespace-nowrap">
                    Disconnect mailbox?
                  </span>
                  <button
                    onClick={disconnect}
                    disabled={disconnecting}
                    className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60 cursor-pointer"
                  >
                    {disconnecting ? 'Disconnecting…' : 'Confirm'}
                  </button>
                  <button
                    onClick={() => setConfirmDisconnect(false)}
                    className="text-xs text-slate-500 hover:text-slate-700 dark:text-[var(--text-200)] cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={disconnect}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-900/15 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 cursor-pointer"
                >
                  Disconnect
                </button>
              ))}
          </div>

          <div className="rounded-lg border border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-200)] divide-y divide-[var(--bg-300)]">
            <div className="p-4">
              <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-[var(--text-200)] mb-0.5">
                Mailbox
              </p>
              <p className="text-sm font-medium text-slate-800 dark:text-[var(--text-100)] break-words">
                {config?.mailboxEmail || 'Not connected'}
              </p>
              {config?.connectedAt && (
                <p className="text-xs text-slate-500 dark:text-[var(--text-200)] mt-0.5">
                  Connected {new Date(config.connectedAt).toLocaleString()}
                  {config.connectedByName && ` by ${config.connectedByName}`}
                </p>
              )}
              {isAdmin && config?.mailboxConnected && (
                <button
                  onClick={connect}
                  className="mt-1 inline-flex items-center gap-1 text-xs text-[var(--accent-200)] hover:underline cursor-pointer"
                >
                  Switch mailbox
                </button>
              )}
            </div>

            <div className="p-4">
              <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-[var(--text-200)] mb-0.5">
                Attachment destination
              </p>
              <p className="text-sm font-medium text-slate-800 dark:text-[var(--text-100)] break-words">
                {config?.driveFolderName || 'Mailbox Drive (root)'}
              </p>
              {config?.driveFolderId && (
                <p className="mt-1 font-mono text-xs text-slate-400 dark:text-[var(--text-200)] break-all">
                  {config.driveFolderId}
                </p>
              )}

              {isAdmin && config?.mailboxConnected && !browserOpen && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    onClick={openBrowser}
                    className="rounded-lg border border-[var(--bg-300)] px-3 py-1.5 text-xs font-medium text-[var(--text-200)] hover:bg-[var(--bg-200)] cursor-pointer"
                  >
                    Choose folder
                  </button>
                  {config.driveFolderId && (
                    <button
                      onClick={() => saveFolder(null)}
                      disabled={saving}
                      className="text-xs text-slate-500 hover:underline disabled:opacity-50 cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                </div>
              )}

              {browserOpen && (
                <div className="mt-3 rounded-lg border border-[var(--bg-300)] bg-[var(--bg-100)]">
                  {/* Breadcrumbs */}
                  <div className="flex flex-wrap items-center gap-1 border-b border-[var(--bg-300)] px-3 py-2 text-xs">
                    <button
                      onClick={() => goToCrumb(-1)}
                      className="text-[var(--accent-200)] hover:underline cursor-pointer"
                    >
                      All drives
                    </button>
                    {crumbs.map((crumb, i) => (
                      <span key={crumb.id} className="flex items-center gap-1">
                        <span className="text-slate-400">/</span>
                        <button
                          onClick={() => goToCrumb(i)}
                          className="text-[var(--accent-200)] hover:underline cursor-pointer"
                        >
                          {crumb.name}
                        </button>
                      </span>
                    ))}
                  </div>

                  <div className="max-h-56 overflow-y-auto">
                    {foldersLoading ? (
                      <p className="px-3 py-6 text-center text-xs text-slate-400">
                        <span className="inline-flex items-center gap-2">
                          <Spinner className="h-3 w-3" /> Loading folders…
                        </span>
                      </p>
                    ) : folders.length === 0 ? (
                      <p className="px-3 py-6 text-center text-xs text-slate-400">No sub-folders here.</p>
                    ) : (
                      <ul className="divide-y divide-[var(--bg-300)]">
                        {folders.map((folder) => (
                          <li key={folder.id}>
                            <button
                              onClick={() => enterFolder(folder)}
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-slate-700 dark:text-[var(--text-200)] hover:bg-[var(--bg-200)] cursor-pointer"
                            >
                              <svg
                                className="h-4 w-4 shrink-0 text-amber-500"
                                viewBox="0 0 24 24"
                                fill="currentColor"
                              >
                                <path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z" />
                              </svg>
                              <span className="truncate">{folder.name}</span>
                              {folder.isSharedDrive && (
                                <span className="ml-auto shrink-0 rounded-full bg-[var(--primary-100)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent-200)]">
                                  Shared drive
                                </span>
                              )}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="flex items-center justify-end gap-2 border-t border-[var(--bg-300)] px-3 py-2">
                    <button
                      onClick={() => setBrowserOpen(false)}
                      className="text-xs text-slate-500 hover:underline cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => saveFolder(currentFolderId)}
                      disabled={saving || !currentFolderId}
                      title={currentFolderId ? undefined : 'Open a folder to select it'}
                      className="rounded-lg bg-[var(--accent-200)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                    >
                      {saving ? 'Saving…' : 'Use this folder'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {!config?.mailboxConnected && (
            <p className="mt-3 text-xs text-slate-500 dark:text-[var(--text-200)]">
              {isAdmin
                ? 'Sign in as the shared invoice mailbox when prompted. Doc Tidy requests read-only Gmail access plus Drive access for storing attachments.'
                : 'Only an admin can connect the Doc Tidy mailbox.'}
            </p>
          )}
        </>
      )}
    </section>
  )
}
