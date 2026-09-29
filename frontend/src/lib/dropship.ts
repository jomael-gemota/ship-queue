import { HH_BRAND_IDS, HH_BRANDS, hhBrand } from './hhBrand'

export const DROPSHIP_PATH = '/ordering'
export const HH_SPORTSWEAR_PATH = HH_BRANDS.sportswear.path
export const HH_WORKWEAR_PATH = HH_BRANDS.workwear.path

export type DropshipBrand = {
  id: string
  name: string
  supplier: string
  catalog: string
  path: string
  logo?: string
  logoFit?: 'cover' | 'contain'
}

export const DROPSHIP_BRANDS: DropshipBrand[] = HH_BRAND_IDS.map((id) => {
  const brand = hhBrand(id)
  return {
    id: brand.slug,
    name: brand.name,
    supplier: brand.supplier,
    catalog: brand.catalog,
    path: brand.path,
    logo: brand.logo,
    logoFit: brand.logoFit,
  }
})
