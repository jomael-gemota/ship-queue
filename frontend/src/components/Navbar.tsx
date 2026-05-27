export default function Navbar() {
  return (
    <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🚢</span>
            <span className="text-xl font-semibold text-gray-900 dark:text-white tracking-tight">
              Ship Queue
            </span>
          </div>
        </div>
      </div>
    </header>
  )
}
