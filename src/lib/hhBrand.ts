export const HH_BRAND_IDS = ['sportswear', 'workwear'] as const;
export type HHBrandId = (typeof HH_BRAND_IDS)[number];

export interface HhBrandDefinition {
  id: HHBrandId;
  slug: 'hh-sportswear' | 'hh-workwear';
  name: string;
  supplier: string;
  configKey: string;
  cookieJarKey: string;
  cookieJarName: string;
  baseUrl: string;
  catalog: string;
  accountId: string;
}

export const HH_BRANDS: Record<HHBrandId, HhBrandDefinition> = {
  sportswear: {
    id: 'sportswear',
    slug: 'hh-sportswear',
    name: 'HH Sportswear',
    supplier: 'Helly Hansen Sports',
    configKey: 'helly-hansen-sports',
    cookieJarKey: 'helly-hansen-sports-b2b',
    cookieJarName: 'Helly Hansen Sports B2B',
    baseUrl: 'https://b2bsport.hellyhansen.com',
    catalog: 'ASAPSPORT',
    accountId: '9014876',
  },
  workwear: {
    id: 'workwear',
    slug: 'hh-workwear',
    name: 'HH Workwear',
    supplier: 'Helly Hansen Work',
    configKey: 'helly-hansen-work',
    cookieJarKey: 'helly-hansen-work-b2b',
    cookieJarName: 'Helly Hansen Work B2B',
    baseUrl: 'https://b2bwork.hellyhansen.com',
    catalog: 'ASAPWW',
    accountId: '9062220',
  },
};

export const HH_DEFAULT_BRAND: HHBrandId = 'sportswear';

export function isHhBrandId(value: unknown): value is HHBrandId {
  return value === 'sportswear' || value === 'workwear';
}

export function hhBrandId(value: unknown): HHBrandId {
  return isHhBrandId(value) ? value : HH_DEFAULT_BRAND;
}

export function hhBrand(brand: HHBrandId | unknown): HhBrandDefinition {
  return HH_BRANDS[hhBrandId(brand)];
}

export function hhBrandFromRequest(req: { hhBrand?: HHBrandId }): HHBrandId {
  return hhBrandId(req.hhBrand);
}

export function attachHhBrand(brand: HHBrandId) {
  return (req: { hhBrand?: HHBrandId }, _res: unknown, next: () => void): void => {
    req.hhBrand = brand;
    next();
  };
}

declare global {
  namespace Express {
    interface Request {
      hhBrand?: HHBrandId;
    }
  }
}
