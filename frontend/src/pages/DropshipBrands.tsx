import { Link } from 'react-router-dom'
import { DROPSHIP_BRANDS, type DropshipBrand } from '../lib/dropship'

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

function BrandMark({ brand }: { brand: DropshipBrand }) {
  if (brand.logo) {
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

export default function DropshipBrands() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900 dark:text-[var(--text-100)]">Brands</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-[var(--text-200)]">
          Open a supplier to import Amazon orders, fill details, and draft B2B carts.
        </p>
      </div>

      <section className="overflow-hidden rounded-xl border border-[var(--bg-300)] bg-[var(--bg-100)] shadow-sm dark:border-[var(--bg-300)] dark:bg-[var(--bg-100)]">
        <ul className="divide-y divide-slate-200 dark:divide-[var(--bg-300)]">
          {DROPSHIP_BRANDS.map((brand) => (
            <li key={brand.id}>
              <Link
                to={brand.path}
                className="flex items-stretch overflow-hidden transition-colors hover:bg-[var(--primary-100)]"
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
      </section>
    </div>
  )
}
