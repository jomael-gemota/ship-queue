import { HH_MISSING, formatHhBuyerInfo } from '../../lib/hhSportswear'
import type { HHChildOrder } from '../../lib/hhSportswear'

function BuyerLine({
  value,
  className,
}: {
  value: string
  className: string
}) {
  const missing = value === HH_MISSING
  return (
    <p className={missing ? `${className} text-slate-400 dark:text-[var(--text-200)]` : className}>
      {value}
    </p>
  )
}

export function HHBuyerInfo({ order }: { order: HHChildOrder }) {
  const info = formatHhBuyerInfo(order)

  return (
    <div className="leading-5">
      <BuyerLine
        value={info.name}
        className="font-medium text-slate-800 dark:text-[var(--text-100)]"
      />
      <BuyerLine
        value={info.line1}
        className="text-slate-700 dark:text-[var(--text-100)]"
      />
      <BuyerLine
        value={info.locality}
        className="text-slate-700 dark:text-[var(--text-100)]"
      />
    </div>
  )
}
