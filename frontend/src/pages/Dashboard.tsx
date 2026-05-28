export default function Dashboard() {
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-5 py-4 shadow-sm">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Ship Queue Dashboard</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Monitor order flow, fulfillment state, and sync health from one workspace.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Pending" value="0" color="yellow" />
        <StatCard label="Processing" value="0" color="blue" />
        <StatCard label="Shipped" value="0" color="green" />
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
        <p className="text-gray-500 dark:text-gray-400 text-sm text-center py-12">
          No shipments yet. Add your first shipment to get started.
        </p>
      </div>
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  const colors: Record<string, string> = {
    yellow: 'bg-yellow-50 border-yellow-200 dark:bg-yellow-900/20 dark:border-yellow-800',
    blue: 'bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800',
    green: 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800',
  }
  return (
    <div className={`rounded-xl border px-5 py-4 shadow-sm ${colors[color]}`}>
      <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</p>
      <p className="text-3xl font-semibold text-gray-900 dark:text-white mt-1">{value}</p>
    </div>
  )
}
