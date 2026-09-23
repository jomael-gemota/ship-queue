import { useState } from 'react'
import { Link } from 'react-router-dom'
import { DROPSHIP_BRANDS, type DropshipBrand } from '../lib/dropship'

type BrandView = 'list' | 'grid'

const VIEW_KEY = 'sq_ordering_brand_view'

function readBrandView(): BrandView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list'
  } catch {
    return 'list'
  }
}

function BagIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"
      />
    </svg>
  )
}

function BrandMark({ brand, framed = false }: { brand: DropshipBrand; framed?: boolean }) {
  if (framed) {
    if (!brand.logo) {
      return (
        <span className="flex h-40 w-full items-center justify-center bg-[var(--bg-200)] text-[var(--accent-200)]">
          <BagIcon className="h-8 w-8" />
        </span>
      )
    }
    return (
      <span className={`block w-full overflow-hidden ${brand.id === 'hh-workwear' ? 'bg-black' : ''}`}>
        <img src={brand.logo} alt="" className="aspect-[5/4] w-full object-cover" />
      </span>
    )
  }

  if (brand.logo) {
    if (brand.id === 'hh-workwear') {
      return (
        <span className="inline-flex h-28 w-36 shrink-0 items-center justify-center bg-black sm:h-32 sm:w-40">
          <img src={brand.logo} alt="" className="h-full w-full object-contain" />
        </span>
      )
    }
    return (
      <img
        src={brand.logo}
        alt=""
        className="h-28 w-36 shrink-0 object-cover sm:h-32 sm:w-40"
      />
    )
  }

  return (
    <span className="inline-flex h-28 w-36 shrink-0 items-center justify-center bg-[var(--bg-200)] text-[var(--accent-200)] sm:h-32 sm:w-40">
      <BagIcon className="h-7 w-7" />
    </span>
  )
}

function ListIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  )
}

function GridIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z"
      />
    </svg>
  )
}

function BrandCard({ brand }: { brand: DropshipBrand }) {
  return (
    <Link
      to={brand.path}
      className="group flex flex-col overflow-hidden rounded-2xl border border-[var(--bg-300)] bg-[var(--bg-100)] transition-all hover:border-[var(--accent-100)] hover:shadow-md dark:border-[var(--bg-300)] dark:bg-[var(--bg-200)] dark:hover:border-[var(--primary-200)] dark:hover:shadow-[0_4px_20px_rgba(0,0,0,0.4)]"
    >
      <BrandMark brand={brand} framed />
      <span className="flex flex-1 flex-col px-5 pb-4 pt-4">
        <span className="text-sm font-semibold text-slate-900 transition-colors group-hover:text-[var(--accent-200)] dark:text-[var(--text-100)] dark:group-hover:text-[var(--primary-300)]">
          {brand.name}
        </span>
        <span className="mt-1 text-xs text-slate-500 dark:text-[var(--text-200)]">
          {brand.supplier}
          <span className="text-slate-400 dark:text-[var(--text-200)]"> · </span>
          {brand.catalog}
        </span>
      </span>
      <span className="flex items-center justify-end border-t border-[var(--bg-300)] px-5 py-3 text-sm font-medium text-[var(--accent-200)]">
        Open
        <svg className="ml-1 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </span>
    </Link>
  )
}

export default function DropshipBrands() {
  const [view, setView] = useState<BrandView>(readBrandView)

  const chooseView = (next: BrandView) => {
    setView(next)
    try {
      localStorage.setItem(VIEW_KEY, next)
    } catch {
      /* ignore */
    }
  }

  const grid = view === 'grid'
  const iconClass = (active: boolean) =>
    `relative z-10 inline-flex h-8 w-8 items-center justify-center transition-colors duration-200 ${
      active
        ? 'text-slate-900 dark:text-[var(--text-100)]'
        : 'text-slate-400 dark:text-[var(--text-200)]'
    }`

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-[var(--text-100)]">Brands</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-[var(--text-200)]">
            Open a supplier to import Amazon orders, fill details, and draft B2B carts.
          </p>
        </div>
        <button
          type="button"
          onClick={() => chooseView(grid ? 'list' : 'grid')}
          aria-label={grid ? 'Show brands as a list' : 'Show brands as a grid'}
          className="relative inline-flex shrink-0 cursor-pointer rounded-lg border border-[var(--bg-300)] bg-[var(--bg-200)] p-0.5 dark:border-[var(--bg-300)] dark:bg-[var(--bg-200)]"
        >
          <span
            aria-hidden
            className={`pointer-events-none absolute top-0.5 left-0.5 h-8 w-8 rounded-md bg-[var(--bg-100)] shadow-sm transition-transform duration-200 ease-out motion-reduce:transition-none ${
              grid ? 'translate-x-8' : 'translate-x-0'
            }`}
          />
          <span className={iconClass(!grid)}>
            <ListIcon />
          </span>
          <span className={iconClass(grid)}>
            <GridIcon />
          </span>
        </button>
      </div>

      {view === 'grid' ? (
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
          {DROPSHIP_BRANDS.map((brand) => (
            <BrandCard key={brand.id} brand={brand} />
          ))}
        </div>
      ) : (
        <ul className="space-y-3">
          {DROPSHIP_BRANDS.map((brand) => (
            <li key={brand.id}>
              <Link
                to={brand.path}
                className="flex items-stretch overflow-hidden rounded-xl border border-[var(--bg-300)] bg-[var(--bg-100)] shadow-sm transition-colors hover:bg-[var(--primary-100)] dark:border-[var(--bg-300)] dark:bg-[var(--bg-100)]"
              >
                <BrandMark brand={brand} />
                <span className="flex min-w-0 flex-1 items-center gap-4 px-5 py-4">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-slate-900 dark:text-[var(--text-100)]">
                      {brand.name}
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500 dark:text-[var(--text-200)]">
                      {brand.supplier}
                      <span className="text-slate-400 dark:text-[var(--text-200)]"> · </span>
                      {brand.catalog}
                    </span>
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-[var(--accent-200)]">
                    Open
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
