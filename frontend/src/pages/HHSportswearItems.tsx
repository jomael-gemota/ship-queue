import { useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { HHStatusBadge } from '../components/hh/hhUi'
import { useHHList } from '../context/HHListContext'
import {
  BoxIcon,
  DollarIcon,
  formatCurrency,
  HeaderLabel,
  IdIcon,
  Td,
  Th,
} from '../components/labels/labelUi'

function TitleIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h10" />
    </svg>
  )
}

function QtyIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h10M7 16h6" />
    </svg>
  )
}

export default function HHSportswearItems() {
  const { groupId = '', orderId = '' } = useParams<{ groupId: string; orderId: string }>()
  const { getOrder, filteredItems, searchInput } = useHHList()
  const match = getOrder(groupId, orderId)

  const totals = useMemo(() => {
    return filteredItems.reduce(
      (acc, item) => ({
        quantity: acc.quantity + item.quantity,
        amount: acc.amount + item.quantity * item.unitPrice,
      }),
      { quantity: 0, amount: 0 },
    )
  }, [filteredItems])

  if (!match) {
    return <p className="px-5 py-10 text-center text-sm text-slate-500 dark:text-[var(--text-200)]">Order not found.</p>
  }

  const { order } = match

  return (
    <>
      <div className="border-b border-[var(--bg-300)] px-5 py-4 dark:border-[var(--bg-300)]">
        <h2 className="inline-flex flex-wrap items-center gap-2 text-base font-semibold text-slate-900 dark:text-[var(--text-100)]">
          <span className="font-mono">{order.orderId}</span>
          <HHStatusBadge status={order.status} />
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-[var(--text-200)]">
          PO {order.po}
          {' · '}
          {order.items.length} item{order.items.length === 1 ? '' : 's'}
        </p>
        <div className="mt-3 grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <p className="font-medium text-slate-800 dark:text-[var(--text-100)]">{order.customerName}</p>
            <p className="break-all text-slate-500 dark:text-[var(--text-200)]">{order.customerEmail}</p>
            <p className="text-slate-500 dark:text-[var(--text-200)]">{order.customerPhone}</p>
          </div>
          <div>
            <p className="text-slate-700 dark:text-[var(--text-100)]">{order.addressLine1}</p>
            <p className="text-slate-600 dark:text-[var(--text-200)]">{order.addressLine2}</p>
            <p className="text-slate-500 dark:text-[var(--text-200)]">{order.country}</p>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[var(--bg-200)] text-xs uppercase tracking-wide text-slate-500 dark:bg-[var(--bg-200)] dark:text-[var(--text-200)]">
            <tr className="text-left">
              <Th>
                <HeaderLabel icon={<TitleIcon className="h-3.5 w-3.5" />} text="Title" />
              </Th>
              <Th>
                <HeaderLabel icon={<BoxIcon className="h-3.5 w-3.5" />} text="SKU" />
              </Th>
              <Th>
                <HeaderLabel icon={<IdIcon className="h-3.5 w-3.5" />} text="ASIN" />
              </Th>
              <Th className="text-right">
                <HeaderLabel className="justify-end" icon={<QtyIcon className="h-3.5 w-3.5" />} text="Quantity" />
              </Th>
              <Th className="text-right">
                <HeaderLabel className="justify-end" icon={<DollarIcon className="h-3.5 w-3.5" />} text="Unit Price" />
              </Th>
              <Th className="text-right">
                <HeaderLabel className="justify-end" icon={<DollarIcon className="h-3.5 w-3.5" />} text="Subtotal" />
              </Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 text-[13px] dark:divide-[var(--bg-300)]">
            {filteredItems.length === 0 ? (
              <tr>
                <Td colSpan={6} className="py-10 text-center text-slate-400 dark:text-[var(--text-200)]">
                  {order.items.length === 0
                    ? 'No line items.'
                    : searchInput.trim()
                      ? `No items match "${searchInput.trim()}".`
                      : 'No line items.'}
                </Td>
              </tr>
            ) : (
              filteredItems.map((item, idx) => {
                const zebra = idx % 2 === 1
                const rowBg = zebra
                  ? 'bg-[var(--bg-200)] dark:bg-[var(--bg-200)]'
                  : 'bg-[var(--bg-100)] dark:bg-[var(--bg-100)]'
                const subtotal = item.quantity * item.unitPrice
                return (
                  <tr key={item.id} className={rowBg}>
                    <Td compact className="max-w-sm text-slate-800 dark:text-[var(--text-100)]">
                      <span className="break-words" title={item.title}>
                        {item.title}
                      </span>
                    </Td>
                    <Td compact className="whitespace-nowrap font-mono text-slate-600 dark:text-[var(--text-200)]">
                      {item.sku}
                    </Td>
                    <Td compact className="whitespace-nowrap font-mono text-slate-600 dark:text-[var(--text-200)]">
                      {item.asin}
                    </Td>
                    <Td compact className="whitespace-nowrap text-right tabular-nums text-slate-700 dark:text-[var(--text-100)]">
                      {item.quantity}
                    </Td>
                    <Td compact className="whitespace-nowrap text-right tabular-nums text-slate-700 dark:text-[var(--text-100)]">
                      {formatCurrency(item.unitPrice)}
                    </Td>
                    <Td compact className="whitespace-nowrap text-right tabular-nums text-slate-700 dark:text-[var(--text-100)]">
                      {formatCurrency(subtotal)}
                    </Td>
                  </tr>
                )
              })
            )}
          </tbody>
          {filteredItems.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-[var(--bg-300)] bg-[var(--bg-200)] text-[13px] font-semibold dark:border-[var(--bg-300)] dark:bg-[var(--bg-200)]">
                <Td compact colSpan={3} className="text-slate-800 dark:text-[var(--text-100)]">
                  Total
                </Td>
                <Td compact className="whitespace-nowrap text-right tabular-nums text-slate-800 dark:text-[var(--text-100)]">
                  {totals.quantity}
                </Td>
                <Td compact />
                <Td compact className="whitespace-nowrap text-right tabular-nums text-slate-800 dark:text-[var(--text-100)]">
                  {formatCurrency(totals.amount)}
                </Td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  )
}
