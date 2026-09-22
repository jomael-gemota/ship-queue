export const HH_BRAND_IDS = ['sportswear', 'workwear'] as const
export type HHBrandId = (typeof HH_BRAND_IDS)[number]

export interface HHBrandDefinition {
  id: HHBrandId
  slug: 'hh-sportswear' | 'hh-workwear'
  name: string
  supplier: string
  catalog: string
  baseUrl: string
  accountId: string
  path: string
  apiPrefix: string
  logo?: string
  cookieJarKey: string
}

export const HH_BRANDS: Record<HHBrandId, HHBrandDefinition> = {
  sportswear: {
    id: 'sportswear',
    slug: 'hh-sportswear',
    name: 'HH Sportswear',
    supplier: 'Helly Hansen Sports',
    catalog: 'ASAPSPORT',
    baseUrl: 'https://b2bsport.hellyhansen.com',
    accountId: '9014876',
    path: '/ordering/hh-sportswear',
    apiPrefix: '/hh-sportswear',
    logo: '/brands/hh-sportswear.png',
    cookieJarKey: 'helly-hansen-sports-b2b',
  },
  workwear: {
    id: 'workwear',
    slug: 'hh-workwear',
    name: 'HH Workwear',
    supplier: 'Helly Hansen Work',
    catalog: 'ASAPWW',
    baseUrl: 'https://b2bwork.hellyhansen.com',
    accountId: '9062220',
    path: '/ordering/hh-workwear',
    apiPrefix: '/hh-workwear',
    logo: '/brands/hh-workwear.png',
    cookieJarKey: 'helly-hansen-work-b2b',
  },
}

export const HH_DEFAULT_BRAND: HHBrandId = 'sportswear'

export function isHhBrandId(value: unknown): value is HHBrandId {
  return value === 'sportswear' || value === 'workwear'
}

export function hhBrandId(value: unknown): HHBrandId {
  return isHhBrandId(value) ? value : HH_DEFAULT_BRAND
}

export function hhBrand(brand: HHBrandId | unknown): HHBrandDefinition {
  return HH_BRANDS[hhBrandId(brand)]
}

export function hhBrandFromPath(pathname: string): HHBrandId {
  if (pathname.includes('/hh-workwear')) return 'workwear'
  return 'sportswear'
}

export function hhBrandPath(brand: HHBrandId, rest = ''): string {
  const base = hhBrand(brand).path
  if (!rest) return base
  return `${base}${rest.startsWith('/') ? rest : `/${rest}`}`
}

export function hhApiPath(brand: HHBrandId, rest = ''): string {
  const base = hhBrand(brand).apiPrefix
  if (!rest) return base
  return `${base}${rest.startsWith('/') ? rest : `/${rest}`}`
}
