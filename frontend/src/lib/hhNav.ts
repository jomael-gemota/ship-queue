import { hhBrandFromPath, hhBrandPath } from './hhBrand'

function hhSlugIndex(parts: string[]): number {
  const sports = parts.indexOf('hh-sportswear')
  if (sports !== -1) return sports
  return parts.indexOf('hh-workwear')
}

export function hhDepth(pathname: string): number {
  const parts = pathname.replace(/\/+$/, '').split('/').filter(Boolean)
  const hhIndex = hhSlugIndex(parts)
  if (hhIndex === -1) return 0
  const rest = parts.slice(hhIndex + 1)
  if (rest[0] === 'configurations') return 1
  if (rest.length >= 3 && rest[1] === 'orders') return 2
  if (rest.length >= 1) return 1
  return 0
}

export type HHPage = 'list' | 'orders' | 'items' | 'config'

export function hhBreadcrumbPage(pathname: string): HHPage {
  const parts = pathname.replace(/\/+$/, '').split('/').filter(Boolean)
  const hhIndex = hhSlugIndex(parts)
  const rest = hhIndex === -1 ? [] : parts.slice(hhIndex + 1)
  if (rest[0] === 'configurations') return 'config'
  const depth = hhDepth(pathname)
  if (depth === 2) return 'items'
  if (depth === 1) return 'orders'
  return 'list'
}

export function hhParentPath(pathname: string, groupId?: string): string | null {
  const brand = hhBrandFromPath(pathname)
  const page = hhBreadcrumbPage(pathname)
  if (page === 'items' && groupId) return hhBrandPath(brand, groupId)
  if (page === 'orders' || page === 'config') return hhBrandPath(brand)
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
