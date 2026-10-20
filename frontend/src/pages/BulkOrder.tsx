import { BULK_ORDER_BRANDS } from '../lib/bulkOrder'
import { OrderingBrandList } from './DropshipBrands'

export default function BulkOrder() {
  return (
    <OrderingBrandList
      brands={BULK_ORDER_BRANDS}
      description="Open a supplier to see its bulk orders."
      viewKey="sq_bulk_order_brand_view"
    />
  )
}
