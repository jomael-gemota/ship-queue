import { useState, useEffect, useCallback } from 'react'
import { authApi } from '../lib/api'
import type { AppSettings, SettingsResponse, DriveFolder } from '../types/label'

interface FoldersResponse {
  data: DriveFolder[]
}

interface Crumb {
  id: string
  name: string
}

/** Extracts a folder ID from a pasted Drive URL, or returns the raw input. */
function extractFolderId(input: string): string {
  const trimmed = input.trim()
  const match = trimmed.match(/folders\/([a-zA-Z0-9_-]+)/)
  return match ? match[1] : trimmed
}

export default function Settings() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Folder browser state
  const [crumbs, setCrumbs] = useState<Crumb[]>([])
  const [folders, setFolders] = useState<DriveFolder[]>([])
  const [foldersLoading, setFoldersLoading] = useState(false)
  const [browserOpen, setBrowserOpen] = useState(false)
  const [manualId, setManualId] = useState('')

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

  const loadFolders = useCallback(async (parentId?: string) => {
    setFoldersLoading(true)
    setError(null)
    try {
      const qs = parentId ? `?parentId=${encodeURIComponent(parentId)}` : ''
      const res = await authApi.get<FoldersResponse>(`/settings/drive/folders${qs}`)
      setFolders(res.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to list Drive folders')
    } finally {
      setFoldersLoading(false)
    }
  }, [])

  const openBrowser = () => {
    setBrowserOpen(true)
    setCrumbs([])
    loadFolders(undefined)
  }

  const enterFolder = (folder: DriveFolder) => {
    setCrumbs((prev) => [...prev, folder])
    loadFolders(folder.id)
  }

  const goToCrumb = (index: number) => {
    if (index < 0) {
      setCrumbs([])
      loadFolders(undefined)
    } else {
      const next = crumbs.slice(0, index + 1)
      setCrumbs(next)
      loadFolders(next[next.length - 1].id)
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

  const currentFolderId = crumbs.length > 0 ? crumbs[crumbs.length - 1].id : null

  return (
    <div className="max-w-3xl space-y-6">
      {error && (
        <Banner tone="error" onClose={() => setError(null)}>{error}</Banner>
      )}
      {success && (
        <Banner tone="success" onClose={() => setSuccess(null)}>{success}</Banner>
      )}

      <section className="rounded-xl border border-slate-300/60 dark:border-gray-800 bg-slate-50 dark:bg-gray-900 p-5">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white mb-1">Google Drive</h2>
        <p className="text-sm text-slate-500 dark:text-gray-400 mb-4">
          Created shipping-label PDFs (named by PO#) are uploaded to your Google Drive.
        </p>

        {loading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-4">
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${settings?.driveConnected ? 'bg-emerald-500' : 'bg-slate-400'}`} />
              <span className="text-sm font-medium text-slate-700 dark:text-gray-200">
                {settings?.driveConnected ? 'Connected' : 'Not connected'}
              </span>
              {!settings?.driveConnected && (
                <a
                  href="/api/auth/google"
                  className="ml-2 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
                >
                  Connect Google Drive
                </a>
              )}
            </div>

            {settings?.driveConnected && (
              <>
                <div className="rounded-lg border border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-950/40 p-4 mb-4">
                  <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-gray-500 mb-1">Destination folder</p>
                  <p className="text-sm font-medium text-slate-800 dark:text-gray-100">
                    {settings.driveFolderName || 'My Drive (root)'}
                  </p>
                  {settings.driveFolderId && (
                    <p className="text-xs text-slate-400 dark:text-gray-500 font-mono mt-0.5">{settings.driveFolderId}</p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={openBrowser}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-gray-700 bg-slate-100 dark:bg-gray-800 px-3 py-2 text-sm font-medium text-slate-700 dark:text-gray-200 hover:bg-slate-200/80 dark:hover:bg-gray-700 transition-colors cursor-pointer"
                  >
                    Browse folders
                  </button>
                  {settings.driveFolderId && (
                    <button
                      onClick={() => saveFolder(null)}
                      disabled={saving}
                      className="text-sm text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-200 disabled:opacity-50 cursor-pointer"
                    >
                      Reset to root
                    </button>
                  )}
                </div>

                {/* Manual folder ID / URL */}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={manualId}
                    onChange={(e) => setManualId(e.target.value)}
                    placeholder="Or paste a Drive folder URL / ID"
                    className="flex-1 min-w-[240px] rounded-lg border border-slate-300 dark:border-gray-700 bg-white dark:bg-gray-950/40 px-3 py-2 text-sm text-slate-700 dark:text-gray-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    onClick={() => saveFolder(extractFolderId(manualId))}
                    disabled={saving || !manualId.trim()}
                    className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
                  >
                    Save
                  </button>
                </div>

                {/* Folder browser */}
                {browserOpen && (
                  <div className="mt-4 rounded-lg border border-slate-200 dark:border-gray-800 overflow-hidden">
                    <div className="flex items-center gap-1 flex-wrap px-3 py-2 bg-slate-100 dark:bg-gray-800/60 text-sm">
                      <button onClick={() => goToCrumb(-1)} className="text-blue-600 dark:text-blue-400 hover:underline cursor-pointer">My Drive</button>
                      {crumbs.map((c, i) => (
                        <span key={c.id} className="flex items-center gap-1">
                          <span className="text-slate-400">/</span>
                          <button onClick={() => goToCrumb(i)} className="text-blue-600 dark:text-blue-400 hover:underline cursor-pointer">{c.name}</button>
                        </span>
                      ))}
                    </div>

                    <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 dark:divide-gray-800">
                      {foldersLoading ? (
                        <p className="px-3 py-3 text-sm text-slate-400">Loading folders…</p>
                      ) : folders.length === 0 ? (
                        <p className="px-3 py-3 text-sm text-slate-400">No subfolders here.</p>
                      ) : (
                        folders.map((f) => (
                          <button
                            key={f.id}
                            onClick={() => enterFolder(f)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 dark:text-gray-200 hover:bg-slate-100 dark:hover:bg-gray-800 cursor-pointer"
                          >
                            <svg className="h-4 w-4 text-amber-500 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path d="M2 5a2 2 0 012-2h4l2 2h6a2 2 0 012 2v7a2 2 0 01-2 2H4a2 2 0 01-2-2V5z" /></svg>
                            {f.name}
                          </button>
                        ))
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-t border-slate-200 dark:border-gray-800 bg-slate-50 dark:bg-gray-900">
                      <span className="text-sm text-slate-500 dark:text-gray-400">
                        {currentFolderId ? `Current: ${crumbs[crumbs.length - 1].name}` : 'Current: My Drive (root)'}
                      </span>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setBrowserOpen(false)} className="text-sm text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-200 cursor-pointer">Cancel</button>
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
              <p className="text-xs text-slate-400 dark:text-gray-500">
                Connecting re-authenticates with Google and grants Drive access so labels can be saved to your Drive.
              </p>
            )}
          </>
        )}
      </section>
    </div>
  )
}

function Banner({ tone, children, onClose }: { tone: 'error' | 'success'; children: React.ReactNode; onClose: () => void }) {
  const styles =
    tone === 'error'
      ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400'
      : 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400'
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${styles}`}>
      <span className="flex-1">{children}</span>
      <button onClick={onClose} className="hover:opacity-70 cursor-pointer">×</button>
    </div>
  )
}
