export const DROPSHIP_PATH = '/ordering'
export const HH_SPORTSWEAR_PATH = '/ordering/hh-sportswear'

export type DropshipBrand = {
  id: string
  name: string
  supplier: string
  catalog: string
  path: string
  logo?: string
}

export const DROPSHIP_BRANDS: DropshipBrand[] = [
  {
    id: 'hh-sportswear',
    name: 'HH Sportswear',
    supplier: 'Helly Hansen Sports',
    catalog: 'ASAPSPORT',
    path: HH_SPORTSWEAR_PATH,
    logo: '/brands/hh-sportswear.png',
  },
]
