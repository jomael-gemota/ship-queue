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
    <p className={missing ? `${className} text-[var(--text-200)]` : className}>
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
        className="font-medium text-[var(--text-100)]"
      />
      <BuyerLine
        value={info.line1}
        className="text-[var(--text-100)]"
      />
      <BuyerLine
        value={info.locality}
        className="text-[var(--text-100)]"
      />
    </div>
  )
}
