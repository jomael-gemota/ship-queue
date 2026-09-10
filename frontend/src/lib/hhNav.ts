export function hhDepth(pathname: string): number {
  const parts = pathname.replace(/\/+$/, '').split('/').filter(Boolean)
  const hhIndex = parts.indexOf('hh-sportswear')
  if (hhIndex === -1) return 0
  const rest = parts.slice(hhIndex + 1)
  if (rest.length >= 3 && rest[1] === 'orders') return 2
  if (rest.length >= 1) return 1
  return 0
}

export type HHPage = 'list' | 'orders' | 'items'

export function hhBreadcrumbPage(pathname: string): HHPage {
  const depth = hhDepth(pathname)
  if (depth === 2) return 'items'
  if (depth === 1) return 'orders'
  return 'list'
}

export function hhParentPath(pathname: string, groupId?: string): string | null {
  const page = hhBreadcrumbPage(pathname)
  if (page === 'items' && groupId) return `/ordering/hh-sportswear/${groupId}`
  if (page === 'orders') return '/ordering/hh-sportswear'
  return null
}

export function hhDirection(from: string, to: string): 'forward' | 'back' | 'none' {
  const a = hhDepth(from)
  const b = hhDepth(to)
  if (b > a) return 'forward'
  if (b < a) return 'back'
  return 'none'
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
