import { useState, useEffect, useCallback } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { authApi } from '../lib/api'
import type {
  LabelRecord,
  LabelBatch,
  BatchItemsResponse,
  CreateBatchLabelsResponse,
} from '../types/label'
import {
  formatDateTime,
  shortBatchId,
  printLabelPdf,
  BatchItemsTable,
  BatchStatusBadge,
  CreatePrintButton,
  ExportCsvButton,
  DeleteBatchButton,
  exportBatchItemsCsv,
  LabelsTableIcon,
  BackIcon,
} from '../components/labels/labelUi'
import { useAuth } from '../context/AuthContext'

const TOKEN_KEY = 'sq_token'

export default function BatchItems() {
  const { batchId = '' } = useParams<{ batchId: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()

  const [batch, setBatch] = useState<LabelBatch | null>(null)
  const [items, setItems] = useState<LabelRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadBatch = useCallback(async () => {
    setLoading(true)
    try {
      const res = await authApi.get<BatchItemsResponse>(`/labels/batches/${batchId}/items`)
      setBatch(res.data.batch)
      setItems(res.data.items)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load batch items')
    } finally {
      setLoading(false)
    }
  }, [batchId])

  useEffect(() => {
    loadBatch()
  }, [loadBatch])

  const handleCreateAndPrint = async () => {
    if (!batch) return
    setCreating(true)
    setError(null)
    try {
      const res = await authApi.post<CreateBatchLabelsResponse>(
        `/labels/batches/${batch._id}/create`,
      )
      const updatedBatch = res.data.batch

      const itemsRes = await authApi.get<BatchItemsResponse>(`/labels/batches/${batch._id}/items`)
      setBatch(updatedBatch)
      setItems(itemsRes.data.items)

      // Print every created label in the batch.
      for (const item of itemsRes.data.items) {
        if (item.status === 'created') {
          await printLabelPdf(item._id)
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create labels')
    } finally {
      setCreating(false)
    }
  }

  const handleExportCsv = () => {
    const base = batch ? shortBatchId(batch._id) : shortBatchId(batchId)
    exportBatchItemsCsv(items, `${base}-items.csv`)
  }

  const handleDeleteBatch = async () => {
    if (!batch) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setDeleting(true)
    setError(null)
    try {
      await authApi.delete(`/labels/batches/${batch._id}`)
      navigate('/create-label')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete batch')
      setConfirmDelete(false)
    } finally {
      setDeleting(false)
    }
  }

  const handleDownloadPdf = async (label: LabelRecord) => {
    setDownloadingId(label._id)
    try {
      const token = localStorage.getItem(TOKEN_KEY)
      const res = await fetch(`/api/labels/${label._id}/pdf`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) throw new Error('PDF not available')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${label.poNumber}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to download PDF')
    } finally {
      setDownloadingId(null)
    }
  }

  const driveConnected = !!user?.driveScopeGranted

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          <svg className="w-4 h-4 shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
          </svg>
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 cursor-pointer">×</button>
        </div>
      )}

      {user?.canCreateLabels && batch?.createdBy === user?.email && !driveConnected && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-900/15 px-4 py-3.5 text-sm text-amber-800 dark:text-amber-300">
          <svg className="w-4 h-4 shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
          </svg>
          <span>
            Google Drive is not connected. Labels cannot be created until you{' '}
            <Link to="/settings" className="font-medium underline underline-offset-2 hover:opacity-80">
              connect Google Drive
            </Link>{' '}
            in Settings.
          </span>
        </div>
      )}

      <Link
        to="/create-label"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-[var(--text-200)] hover:text-slate-700 dark:hover:text-[var(--text-100)] transition-colors"
      >
        <BackIcon className="h-4 w-4" />
        Back to batches
      </Link>

      <section className="rounded-xl border border-[var(--bg-300)] dark:border-[var(--bg-300)] bg-[var(--bg-100)] dark:bg-[var(--bg-100)] overflow-hidden">
        {/* Batch header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--bg-300)] dark:border-[var(--bg-300)] px-5 py-4">
          <div>
            <h2 className="inline-flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-[var(--text-100)]">
              <LabelsTableIcon className="h-4 w-4 text-[var(--accent-100)] dark:text-[var(--accent-200)]" />
              <span className="font-mono">{batch ? shortBatchId(batch._id) : shortBatchId(batchId)}</span>
              {batch && <BatchStatusBadge status={batch.status} testLabel={batch.testLabel} />}
            </h2>
            <p className="text-sm text-slate-500 dark:text-[var(--text-200)]">
              {batch ? (
                <>
                  {batch.itemCount} item{batch.itemCount === 1 ? '' : 's'}
                  {batch.fileName ? ` · ${batch.fileName}` : ''}
                  {` · ${formatDateTime(batch.createdAt)}`}
                  {batch.createdBy ? ` · ${batch.createdBy}` : ''}
                </>
              ) : (
                'Loading batch…'
              )}
            </p>
          </div>
          {batch && (
            <div className="flex items-center gap-2">
              {user?.canCreateLabels && batch.createdBy === user?.email && (
                <CreatePrintButton
                  busy={creating}
                  done={batch.status === 'created'}
                  disabled={!driveConnected}
                  title={!driveConnected ? 'Connect Google Drive in Settings first' : undefined}
                  onClick={handleCreateAndPrint}
                />
              )}
              <ExportCsvButton onClick={handleExportCsv} />
              {user && batch.createdBy === user.email && (
                confirmDelete ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-red-600 dark:text-red-400 whitespace-nowrap">Delete batch?</span>
                    <button
                      onClick={handleDeleteBatch}
                      disabled={deleting}
                      className="rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60 transition-colors cursor-pointer"
                    >
                      {deleting ? 'Deleting…' : 'Confirm'}
                    </button>
                    <button
                      onClick={() => setConfirmDelete(false)}
                      className="text-xs text-slate-500 dark:text-[var(--text-200)] hover:text-slate-700 dark:hover:text-[var(--text-100)] cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <DeleteBatchButton onClick={handleDeleteBatch} />
                )
              )}
            </div>
          )}
        </div>

        {/* Item table */}
        <BatchItemsTable
          items={items}
          loading={loading}
          downloadingId={downloadingId}
          onDownloadPdf={handleDownloadPdf}
        />
      </section>
    </div>
  )
}
