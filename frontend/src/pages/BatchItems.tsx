import { useState, useEffect, useCallback } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { authApi } from '../lib/api'
import type {
  LabelRecord,
  LabelBatch,
  BatchItemsResponse,
  CreateBatchLabelsResponse,
  RefreshBatchItemsResponse,
  UpdateLabelItemResponse,
  RecreateLabelItemResponse,
  PreflightResponse,
  PreflightSummary,
  PreflightItem,
} from '../types/label'
import {
  formatDateTime,
  shortBatchId,
  printLabelPdf,
  BatchItemsTable,
  BatchStatusBadge,
  CreatePrintButton,
  ExportCsvButton,
  ExportZipButton,
  DeleteBatchButton,
  ConfirmDeleteBatchModal,
  ConfirmCreateLabelsModal,
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
  const [refreshing, setRefreshing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmCreate, setConfirmCreate] = useState(false)
  const [preflightLoading, setPreflightLoading] = useState(false)
  const [preflightSummary, setPreflightSummary] = useState<PreflightSummary | null>(null)
  const [preflightItems, setPreflightItems] = useState<PreflightItem[]>([])
  const [preflightError, setPreflightError] = useState<string | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [zipping, setZipping] = useState(false)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [recreatingId, setRecreatingId] = useState<string | null>(null)
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

  // Re-resolve "Not found" items against the (newly synced) orders table. Pulls
  // in shipping details for orders that became available after the batch was
  // drafted — no labels are created here.
  const handleRefresh = async () => {
    if (!batchId) return
    setRefreshing(true)
    setError(null)
    setNotice(null)
    try {
      const res = await authApi.post<RefreshBatchItemsResponse>(
        `/labels/batches/${batchId}/refresh`,
      )
      setBatch(res.data.batch)
      setItems(res.data.items)
      const { checked, resolved } = res.data
      if (checked === 0) {
        setNotice('No "Not found" items to re-check.')
      } else if (resolved === 0) {
        setNotice(`Re-checked ${checked} item${checked === 1 ? '' : 's'} — still not found in the orders table. Sync the orders table and try again.`)
      } else {
        setNotice(`Resolved ${resolved} of ${checked} item${checked === 1 ? '' : 's'} from the orders table.`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to re-check orders')
    } finally {
      setRefreshing(false)
    }
  }

  // Opens the confirmation modal and runs a read-only preflight so the operator
  // can verify the enforced Ship From + Insurance before any billable purchase.
  const handleOpenConfirm = async () => {
    if (!batch) return
    setConfirmCreate(true)
    setPreflightLoading(true)
    setPreflightError(null)
    setPreflightSummary(null)
    setPreflightItems([])
    try {
      const res = await authApi.post<PreflightResponse>(`/labels/batches/${batch._id}/preflight`)
      setPreflightSummary(res.data.summary)
      setPreflightItems(res.data.items)
    } catch (e) {
      setPreflightError(e instanceof Error ? e.message : 'Failed to verify orders')
    } finally {
      setPreflightLoading(false)
    }
  }

  const handleConfirmCreate = async () => {
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
      setConfirmCreate(false)

      // Print every created label in the batch.
      for (const item of itemsRes.data.items) {
        if (item.status === 'created') {
          await printLabelPdf(item._id)
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create labels')
      setConfirmCreate(false)
    } finally {
      setCreating(false)
    }
  }

  const handleExportCsv = () => {
    const base = batch ? shortBatchId(batch._id) : shortBatchId(batchId)
    exportBatchItemsCsv(items, `${base}-items.csv`)
  }

  // Downloads every created label's PDF in this batch as a single zip archive.
  const handleExportZip = async () => {
    if (!batch) return
    setZipping(true)
    setError(null)
    try {
      const token = localStorage.getItem(TOKEN_KEY)
      const res = await fetch(`/api/labels/batches/${batch._id}/labels.zip`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) {
        let message = 'Failed to export label PDFs'
        try {
          const body = await res.json()
          if (body?.message) message = body.message
          if (body?.error) message = `${message} (${body.error})`
        } catch {
          /* non-JSON error body */
        }
        throw new Error(message)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${shortBatchId(batch._id)}-labels.zip`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to export label PDFs')
    } finally {
      setZipping(false)
    }
  }

  const handleDeleteBatch = () => {
    if (!batch) return
    setConfirmDelete(true)
  }

  const handleConfirmDelete = async () => {
    if (!batch) return
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

  // Edits a single item's Property and re-derives its Service. Optimistically
  // updates the cell (so Service flips in real-time), then reconciles with the
  // server's authoritative item. Reverts on failure.
  const handleUpdateProperty = async (
    labelId: string,
    propertyType: 'residential' | 'commercial',
  ) => {
    const snapshot = items.find((it) => it._id === labelId)
    setUpdatingId(labelId)
    setError(null)
    const derivedService =
      propertyType === 'residential' ? 'amazon_fedex_home_delivery' : 'amazon_fedex_ground'
    setItems((prev) =>
      prev.map((it) =>
        it._id === labelId
          ? { ...it, propertyType, propertyOverride: propertyType, serviceCode: derivedService }
          : it,
      ),
    )
    try {
      const res = await authApi.patch<UpdateLabelItemResponse>(`/labels/${labelId}`, {
        propertyType,
      })
      setItems((prev) => prev.map((it) => (it._id === labelId ? res.data.item : it)))
    } catch (e) {
      if (snapshot) {
        setItems((prev) => prev.map((it) => (it._id === labelId ? snapshot : it)))
      }
      setError(e instanceof Error ? e.message : 'Failed to update property')
    } finally {
      setUpdatingId(null)
    }
  }

  // Re-attempts a single failed item with its corrected Property/Service, then
  // prints the new label if the purchase succeeded.
  const handleRecreate = async (labelId: string) => {
    if (!driveConnected) {
      setError('Google Drive is not connected. Connect it in Settings before recreating labels.')
      return
    }
    setRecreatingId(labelId)
    setError(null)
    try {
      const res = await authApi.post<RecreateLabelItemResponse>(`/labels/${labelId}/recreate`)
      const updated = res.data.item
      // Re-pull batch + items so the batch status badge stays in sync.
      const refreshed = await authApi.get<BatchItemsResponse>(`/labels/batches/${batchId}/items`)
      setBatch(refreshed.data.batch)
      setItems(refreshed.data.items)
      if (updated.status === 'created') {
        await printLabelPdf(updated._id)
      } else if (updated.error) {
        setError(`Recreate failed: ${updated.error}`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to recreate label')
    } finally {
      setRecreatingId(null)
    }
  }

  const driveConnected = !!user?.driveScopeGranted
  const hasCreatedLabels = items.some((l) => l.status === 'created')
  const canEdit = !!(user?.canCreateLabels && batch?.createdBy === user?.email)

  return (
    <div className="space-y-6">
      {confirmDelete && batch && (
        <ConfirmDeleteBatchModal
          batchShortId={shortBatchId(batch._id)}
          onConfirm={handleConfirmDelete}
          onCancel={() => setConfirmDelete(false)}
          deleting={deleting}
        />
      )}
      {confirmCreate && (
        <ConfirmCreateLabelsModal
          loading={preflightLoading}
          creating={creating}
          summary={preflightSummary}
          items={preflightItems}
          error={preflightError}
          onConfirm={handleConfirmCreate}
          onCancel={() => setConfirmCreate(false)}
        />
      )}
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

      {notice && (
        <div className="notice-card notice-card--info flex items-start gap-2 text-sm">
          <span className="flex-1">{notice}</span>
          <button
            onClick={() => setNotice(null)}
            className="rounded-md p-0.5 text-slate-500/70 hover:bg-slate-200/60 hover:text-slate-700 dark:text-[var(--text-200)] dark:hover:bg-[var(--bg-300)] transition-colors cursor-pointer"
          >
            ×
          </button>
        </div>
      )}

      {user?.canCreateLabels && batch?.createdBy === user?.email && !driveConnected && (
        <div className="notice-card notice-card--warning flex items-start gap-3 text-sm">
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
              {batch && <BatchStatusBadge status={batch.status} />}
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
                  onClick={handleOpenConfirm}
                />
              )}
              <ExportCsvButton onClick={handleExportCsv} />
              <ExportZipButton
                busy={zipping}
                disabled={!hasCreatedLabels}
                title={hasCreatedLabels ? 'Export label PDFs (.zip)' : 'No created label PDFs to export yet'}
                onClick={handleExportZip}
              />
              {user && batch.createdBy === user.email && (
                <DeleteBatchButton onClick={handleDeleteBatch} />
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
          onRefresh={handleRefresh}
          refreshing={refreshing}
          canEdit={canEdit}
          onUpdateProperty={handleUpdateProperty}
          onRecreate={handleRecreate}
          updatingId={updatingId}
          recreatingId={recreatingId}
          driveConnected={driveConnected}
        />
      </section>
    </div>
  )
}
