export const HH_BRAND_IDS = ['sportswear', 'workwear', 'thorogood'] as const
export type HHBrandId = (typeof HH_BRAND_IDS)[number]

export type HHDraftMode = 'b2b' | 'order-details'

export interface HHBrandDefinition {
  id: HHBrandId
  slug: 'hh-sportswear' | 'hh-workwear' | 'thorogood'
  name: string
  supplier: string
  catalog: string
  baseUrl: string
  accountId: string
  path: string
  apiPrefix: string
  logo?: string
  logoFit?: 'cover' | 'contain'
  /** Scales a contain logo inside its tile. Used when the source art has empty margin. */
  logoScale?: number
  cookieJarKey: string
  draftMode: HHDraftMode
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
    draftMode: 'b2b',
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
    draftMode: 'b2b',
  },
  thorogood: {
    id: 'thorogood',
    slug: 'thorogood',
    name: 'Thorogood',
    supplier: 'Thorogood',
    catalog: 'Order details sync',
    baseUrl: 'https://thorogood.thorogoodb2b.com',
    accountId: '23550',
    path: '/ordering/thorogood',
    apiPrefix: '/thorogood',
    logo: '/brands/thorogood.jpg',
    logoFit: 'contain',
    logoScale: 1.42,
    cookieJarKey: '',
    draftMode: 'order-details',
  },
}

export const HH_DEFAULT_BRAND: HHBrandId = 'sportswear'

export function isHhBrandId(value: unknown): value is HHBrandId {
  return typeof value === 'string' && (HH_BRAND_IDS as readonly string[]).includes(value)
}

export function hhUsesOrderDetailsDraft(brand: HHBrandId | unknown): boolean {
  return hhBrand(brand).draftMode === 'order-details'
}

export function hhBrandId(value: unknown): HHBrandId {
  return isHhBrandId(value) ? value : HH_DEFAULT_BRAND
}

export function hhBrand(brand: HHBrandId | unknown): HHBrandDefinition {
  return HH_BRANDS[hhBrandId(brand)]
}

export function hhBrandFromPath(pathname: string): HHBrandId {
  const match = HH_BRAND_IDS.find((id) => pathname.includes(`/${HH_BRANDS[id].slug}`))
  return match ?? HH_DEFAULT_BRAND
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
