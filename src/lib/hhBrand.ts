export const HH_BRAND_IDS = ['sportswear', 'workwear', 'thorogood'] as const;
export type HHBrandId = (typeof HH_BRAND_IDS)[number];

/** `b2b` posts a live supplier cart. `order-details` drafts that cart from synced Seller Central details. */
export type HhDraftMode = 'b2b' | 'order-details';

/** Stored on the order until a supplier API returns a real document id. */
export const ORDER_DETAILS_DRAFT_PREFIX = 'details:';

export interface HhBrandDefinition {
  id: HHBrandId;
  slug: 'hh-sportswear' | 'hh-workwear' | 'thorogood';
  name: string;
  supplier: string;
  configKey: string;
  cookieJarKey: string;
  cookieJarName: string;
  baseUrl: string;
  catalog: string;
  accountId: string;
  draftMode: HhDraftMode;
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
    draftMode: 'b2b',
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
    draftMode: 'b2b',
  },
  thorogood: {
    id: 'thorogood',
    slug: 'thorogood',
    name: 'Thorogood',
    supplier: 'Thorogood',
    configKey: 'thorogood',
    cookieJarKey: 'thorogood-b2b',
    cookieJarName: 'Thorogood B2B',
    baseUrl: 'https://thorogood.thorogoodb2b.com',
    catalog: 'Thorogood Boots',
    accountId: '23550',
    draftMode: 'order-details',
  },
};

export const HH_DEFAULT_BRAND: HHBrandId = 'sportswear';

export function isHhBrandId(value: unknown): value is HHBrandId {
  return typeof value === 'string' && (HH_BRAND_IDS as readonly string[]).includes(value);
}

export function hhDraftMode(brand: HHBrandId | unknown): HhDraftMode {
  return hhBrand(brand).draftMode;
}

export function isOrderDetailsDraftId(value: string | null | undefined): boolean {
  return (value ?? '').startsWith(ORDER_DETAILS_DRAFT_PREFIX);
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
