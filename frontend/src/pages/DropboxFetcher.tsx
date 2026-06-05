import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { authApi, ApiError } from '../lib/api'
import type { AppSettings, SettingsResponse, DropboxFolder, DropboxLinksResult } from '../types/label'

interface FoldersResponse {
  data: DropboxFolder[]
}

interface LinksResponse {
  data: DropboxLinksResult
}

interface Crumb {
  path: string
  name: string
}

/** File-type catalog. `extensions` is matched (case-insensitive) against file names. */
const FILE_TYPES: { id: string; label: string; extensions: string[] }[] = [
  { id: 'all', label: 'All files', extensions: [] },
  { id: 'pdf', label: 'PDF (.pdf)', extensions: ['pdf'] },
  { id: 'csv', label: 'CSV (.csv)', extensions: ['csv'] },
  { id: 'excel', label: 'Excel (.xls, .xlsx)', extensions: ['xls', 'xlsx', 'xlsm', 'xlsb'] },
  { id: 'word', label: 'Word (.doc, .docx)', extensions: ['doc', 'docx'] },
  { id: 'powerpoint', label: 'PowerPoint (.ppt, .pptx)', extensions: ['ppt', 'pptx'] },
  { id: 'images', label: 'Images (.jpg, .png, …)', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'bmp', 'tiff', 'svg'] },
  { id: 'text', label: 'Text (.txt)', extensions: ['txt'] },
  { id: 'archives', label: 'Archives (.zip, .rar, …)', extensions: ['zip', 'rar', '7z', 'tar', 'gz'] },
]

function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes === null) return ''
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[i]}`
}

export default function DropboxFetcher() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tokenExpired, setTokenExpired] = useState(false)

  // Folder browser
  const [crumbs, setCrumbs] = useState<Crumb[]>([])
  const [folders, setFolders] = useState<DropboxFolder[]>([])
  const [foldersLoading, setFoldersLoading] = useState(false)

  // Extraction controls
  const [fileTypeId, setFileTypeId] = useState('all')
  const [recursive, setRecursive] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [result, setResult] = useState<DropboxLinksResult | null>(null)
  const [copied, setCopied] = useState(false)

  const connected = !!settings?.dropboxConnected
  const currentPath = crumbs.length > 0 ? crumbs[crumbs.length - 1].path : ''
  const currentName = crumbs.length > 0 ? crumbs[crumbs.length - 1].name : 'Dropbox (root)'

  const loadSettings = useCallback(async () => {
    try {
      const res = await authApi.get<SettingsResponse>('/settings')
      setSettings(res.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load settings')
    } finally {
      setSettingsLoading(false)
    }
  }, [])

  const loadFolders = useCallback(async (path: string): Promise<boolean> => {
    setFoldersLoading(true)
    setError(null)
    try {
      const query = path ? `?path=${encodeURIComponent(path)}` : ''
      const res = await authApi.get<FoldersResponse>(`/dropbox/folders${query}`)
      setFolders(res.data)
      return true
    } catch (e) {
      if (e instanceof ApiError && e.code === 'dropbox_token_expired') {
        setTokenExpired(true)
      }
      setError(e instanceof Error ? e.message : 'Failed to list Dropbox folders')
      setFolders([])
      return false
    } finally {
      setFoldersLoading(false)
    }
  }, [])

  // Fire-and-forget persistence of the current setup so it survives refresh/logout.
  const persistPrefs = useCallback((next: { crumbs: Crumb[]; fileType: string; recursive: boolean }) => {
    const folderPath = next.crumbs.length > 0 ? next.crumbs[next.crumbs.length - 1].path : ''
    authApi
      .put('/dropbox/preferences', {
        folderPath,
        crumbs: next.crumbs,
        fileType: next.fileType,
        recursive: next.recursive,
      })
      .catch(() => {
        /* non-fatal — setup still works for this session */
      })
  }, [])

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  // Once Dropbox is connected, restore the user's last setup (folder + file type
  // + recursion) exactly once, then list that folder. Falls back to root if the
  // saved folder no longer exists (without clobbering the saved prefs).
  const restoredRef = useRef(false)
  useEffect(() => {
    if (!settings || !connected || restoredRef.current) return
    restoredRef.current = true

    const prefs = settings.dropboxPrefs
    if (!prefs) {
      loadFolders('')
      return
    }

    if (FILE_TYPES.some((t) => t.id === prefs.fileType)) setFileTypeId(prefs.fileType)
    setRecursive(Boolean(prefs.recursive))
    const restoredCrumbs = Array.isArray(prefs.crumbs) ? prefs.crumbs : []
    setCrumbs(restoredCrumbs)

    const path = restoredCrumbs.length > 0 ? restoredCrumbs[restoredCrumbs.length - 1].path : (prefs.folderPath || '')
    loadFolders(path).then((ok) => {
      if (!ok && path) {
        setCrumbs([])
        setError(null)
        loadFolders('')
      }
    })
  }, [settings, connected, loadFolders])

  const enterFolder = (folder: DropboxFolder) => {
    setResult(null)
    const next = [...crumbs, { path: folder.path, name: folder.name }]
    setCrumbs(next)
    loadFolders(folder.path)
    persistPrefs({ crumbs: next, fileType: fileTypeId, recursive })
  }

  const goToCrumb = (index: number) => {
    setResult(null)
    const next = index < 0 ? [] : crumbs.slice(0, index + 1)
    setCrumbs(next)
    loadFolders(next.length > 0 ? next[next.length - 1].path : '')
    persistPrefs({ crumbs: next, fileType: fileTypeId, recursive })
  }

  const handleExtract = async () => {
    setExtracting(true)
    setError(null)
    setResult(null)
    setCopied(false)
    try {
      const extensions = FILE_TYPES.find((t) => t.id === fileTypeId)?.extensions ?? []
      const res = await authApi.post<LinksResponse>('/dropbox/links', {
        path: currentPath,
        extensions,
        recursive,
      })
      setResult(res.data)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'dropbox_token_expired') {
        setTokenExpired(true)
      }
      setError(e instanceof Error ? e.message : 'Failed to extract links')
    } finally {
      setExtracting(false)
    }
  }

  const handleCopyAll = async () => {
    if (!result || result.links.length === 0) return
    const text = result.links.map((l) => l.url).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Could not copy to clipboard. Your browser may have blocked it.')
    }
  }

  const handleExport = () => {
    if (!result || result.links.length === 0) return
    const text = result.links.map((l) => l.url).join('\r\n')
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const safeName = (currentName || 'dropbox').replace(/[^a-z0-9-_]+/gi, '_')
    a.href = url
    a.download = `${safeName}-links.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // Not connected — guide the user to Settings.
  if (!settingsLoading && !connected) {
    return (
      <div className="max-w-3xl">
        <section className="rounded-xl border border-[var(--bg-300)] dark:border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-100)] p-8 text-center">
          <span className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[#0061FF]/10 dark:bg-[#0061FF]/20 mb-4">
            <DropboxLogo className="h-8 w-8" />
          </span>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-[var(--text-100)]">Connect Dropbox to get started</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-[var(--text-200)] max-w-md mx-auto">
            The Dropbox Fetcher lets you browse a folder, pick a file type, and pull together shareable links for every matching file.
          </p>
          <Link
            to="/settings"
            className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-[#0061FF] px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-colors"
          >
            <DropboxLogo className="h-4 w-4" mono />
            Connect in Settings
          </Link>
        </section>
      </div>
    )
  }

  return (
    <div className="max-w-4xl space-y-6">
      {error && (
        <div className="notice-card notice-card--error flex items-start gap-2 text-sm">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="rounded-md p-0.5 text-red-700/70 hover:bg-red-100 hover:text-red-900 dark:text-red-300 dark:hover:bg-red-900/40 cursor-pointer">×</button>
        </div>
      )}

      {tokenExpired && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-900/15 px-4 py-3">
          <svg className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Dropbox connection expired</p>
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
              Your Dropbox connection was revoked or expired. <Link to="/settings" className="underline">Reconnect in Settings</Link> to continue.
            </p>
          </div>
        </div>
      )}

      {/* Step 1 — choose a folder */}
      <section className="rounded-xl border border-[var(--bg-300)] dark:border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-100)] p-5">
        <div className="flex items-center gap-2 mb-3">
          <StepBadge n={1} />
          <h2 className="text-base font-semibold text-slate-900 dark:text-[var(--text-100)]">Choose a folder</h2>
        </div>

        <div className="rounded-lg border border-[var(--bg-300)] dark:border-[var(--bg-300)] overflow-hidden">
          {/* Breadcrumb */}
          <div className="flex items-center gap-1 flex-wrap px-3 py-2 bg-[var(--bg-200)] dark:bg-[var(--bg-200)] text-sm">
            <button onClick={() => goToCrumb(-1)} className="inline-flex items-center gap-1 text-[var(--accent-100)] dark:text-[var(--accent-200)] hover:underline cursor-pointer">
              <DropboxLogo className="h-3.5 w-3.5" />
              Dropbox
            </button>
            {crumbs.map((c, i) => (
              <span key={c.path} className="flex items-center gap-1">
                <span className="text-slate-400">/</span>
                <button onClick={() => goToCrumb(i)} className="text-[var(--accent-100)] dark:text-[var(--accent-200)] hover:underline cursor-pointer">{c.name}</button>
              </span>
            ))}
          </div>

          {/* Folder list */}
          <div className="max-h-72 overflow-y-auto divide-y divide-[var(--bg-300)] dark:divide-[var(--bg-300)]">
            {foldersLoading ? (
              <p className="px-3 py-3 text-sm text-slate-400">Loading folders…</p>
            ) : folders.length === 0 ? (
              <p className="px-3 py-3 text-sm text-slate-400">No subfolders here. You can extract files directly from this folder.</p>
            ) : (
              folders.map((f) => (
                <button
                  key={f.path}
                  onClick={() => enterFolder(f)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 dark:text-[var(--text-200)] hover:bg-[var(--primary-100)] dark:hover:bg-[var(--primary-100)] cursor-pointer"
                >
                  <svg className="h-4 w-4 text-[#0061FF] shrink-0" fill="currentColor" viewBox="0 0 20 20"><path d="M2 5a2 2 0 012-2h4l2 2h6a2 2 0 012 2v7a2 2 0 01-2 2H4a2 2 0 01-2-2V5z" /></svg>
                  <span className="truncate">{f.name}</span>
                  <svg className="ml-auto h-4 w-4 text-slate-300 dark:text-[var(--text-200)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                </button>
              ))
            )}
          </div>

          {/* Current selection footer */}
          <div className="flex items-center gap-1.5 px-3 py-2.5 border-t border-[var(--bg-300)] dark:border-[var(--bg-300)] bg-[var(--bg-200)] dark:bg-[var(--bg-100)] text-sm text-slate-600 dark:text-[var(--text-200)]">
            <svg className="h-4 w-4 shrink-0 text-[#0061FF]" fill="currentColor" viewBox="0 0 20 20"><path d="M2 5a2 2 0 012-2h4l2 2h6a2 2 0 012 2v7a2 2 0 01-2 2H4a2 2 0 01-2-2V5z" /></svg>
            <span className="truncate">Selected folder: <span className="font-medium text-slate-800 dark:text-[var(--text-100)]">{currentName}</span></span>
          </div>
        </div>
      </section>

      {/* Step 2 — choose file type + extract */}
      <section className="rounded-xl border border-[var(--bg-300)] dark:border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-100)] p-5">
        <div className="flex items-center gap-2 mb-3">
          <StepBadge n={2} />
          <h2 className="text-base font-semibold text-slate-900 dark:text-[var(--text-100)]">Choose file type & extract</h2>
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[220px]">
            <label className="block text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-[var(--text-200)] mb-1">File type</label>
            <select
              value={fileTypeId}
              onChange={(e) => {
                const value = e.target.value
                setFileTypeId(value)
                persistPrefs({ crumbs, fileType: value, recursive })
              }}
              className="w-full rounded-lg border border-[var(--bg-300)] dark:border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-200)] px-3 py-2 text-sm text-slate-700 dark:text-[var(--text-100)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-200)] cursor-pointer"
            >
              {FILE_TYPES.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-[var(--text-200)] cursor-pointer select-none pb-2">
            <input
              type="checkbox"
              checked={recursive}
              onChange={(e) => {
                const value = e.target.checked
                setRecursive(value)
                persistPrefs({ crumbs, fileType: fileTypeId, recursive: value })
              }}
              className="h-4 w-4 rounded border-[var(--bg-300)] text-[#0061FF] focus:ring-[var(--accent-200)] cursor-pointer"
            />
            Include files in sub-folders
          </label>

          <button
            onClick={handleExtract}
            disabled={extracting || tokenExpired}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-[#0061FF] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            {extracting ? (
              <>
                <Spinner className="h-4 w-4" />
                Extracting…
              </>
            ) : (
              <>
                <LinkIcon className="h-4 w-4" />
                Extract links
              </>
            )}
          </button>
        </div>
      </section>

      {/* Step 3 — results */}
      {result && (
        <section className="rounded-xl border border-[var(--bg-300)] dark:border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-100)] p-5">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <StepBadge n={3} />
            <h2 className="text-base font-semibold text-slate-900 dark:text-[var(--text-100)]">
              Links <span className="text-slate-400 font-normal">({result.links.length})</span>
            </h2>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={handleCopyAll}
                disabled={result.links.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--bg-300)] dark:border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-200)] px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-[var(--text-200)] hover:bg-[var(--primary-100)] dark:hover:bg-[var(--primary-100)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                {copied ? <CheckIcon className="h-4 w-4 text-emerald-500" /> : <CopyIcon className="h-4 w-4" />}
                {copied ? 'Copied!' : 'Copy all'}
              </button>
              <button
                onClick={handleExport}
                disabled={result.links.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                <DownloadIcon className="h-4 w-4" />
                Export .txt
              </button>
            </div>
          </div>

          <p className="text-xs text-slate-500 dark:text-[var(--text-200)] mb-3">
            Scanned {result.scanned} matching file{result.scanned === 1 ? '' : 's'}.
            {result.failures.length > 0 && (
              <span className="text-amber-600 dark:text-amber-400"> {result.failures.length} could not be linked (skipped).</span>
            )}
          </p>

          {result.links.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[var(--bg-300)] dark:border-[var(--bg-300)] px-4 py-6 text-center text-sm text-slate-400">
              No matching files found in this folder.
            </p>
          ) : (
            <div className="rounded-lg border border-[var(--bg-300)] dark:border-[var(--bg-300)] overflow-hidden divide-y divide-[var(--bg-300)] dark:divide-[var(--bg-300)] max-h-[28rem] overflow-y-auto">
              {result.links.map((link, i) => (
                <div
                  key={link.path}
                  className={`flex items-center gap-3 px-3 py-2.5 ${i % 2 === 0 ? 'bg-[var(--bg-100)] dark:bg-[var(--bg-100)]' : 'bg-[var(--bg-200)]/50 dark:bg-[var(--bg-200)]/40'}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800 dark:text-[var(--text-100)] truncate">
                      {link.name}
                      {link.size !== undefined && (
                        <span className="ml-2 text-xs font-normal text-slate-400">{formatBytes(link.size)}</span>
                      )}
                    </p>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-[var(--accent-100)] dark:text-[var(--accent-200)] hover:underline break-all"
                    >
                      {link.url}
                    </a>
                  </div>
                  <CopyOneButton url={link.url} />
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}

function CopyOneButton({ url }: { url: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url)
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        } catch {
          /* ignore */
        }
      }}
      title="Copy link"
      className="shrink-0 inline-flex items-center justify-center rounded-md border border-[var(--bg-300)] dark:border-[var(--bg-300)] h-8 w-8 text-slate-500 dark:text-[var(--text-200)] hover:bg-[var(--primary-100)] dark:hover:bg-[var(--primary-100)] cursor-pointer"
    >
      {done ? <CheckIcon className="h-4 w-4 text-emerald-500" /> : <CopyIcon className="h-4 w-4" />}
    </button>
  )
}

function StepBadge({ n }: { n: number }) {
  return (
    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#0061FF] text-xs font-semibold text-white">
      {n}
    </span>
  )
}

function DropboxLogo({ className = '', mono = false }: { className?: string; mono?: boolean }) {
  const fill = mono ? 'currentColor' : '#0061FF'
  return (
    <svg className={className} viewBox="0 0 24 24" fill={fill} aria-hidden="true">
      <path d="M6 2 0 5.9l6 3.9 6-3.9L6 2Zm12 0-6 3.9 6 3.9 6-3.9L18 2ZM0 13.7l6 3.9 6-3.9-6-3.9-6 3.9Zm18-3.9-6 3.9 6 3.9 6-3.9-6-3.9ZM6 18.9l6 3.9 6-3.9-6-3.9-6 3.9Z" />
    </svg>
  )
}

function LinkIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 010 5.656l-3 3a4 4 0 01-5.656-5.656l1.5-1.5m8.656-2.828a4 4 0 00-5.656 0l-1.5 1.5m5.656 5.656l-3-3" />
    </svg>
  )
}

function CopyIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  )
}

function CheckIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  )
}

function DownloadIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
  )
}

function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}
