/** Helly Hansen US Ship Via. `-` is Default. `MSB` is USPS Priority Post Billable. */
export const HH_SHIP_VIA_DEFAULT = '-';
export const HH_SHIP_VIA_USPS_PRIORITY = 'MSB';
/** Batch source file for the local Ship Via UI preview. Never posted to Helly Hansen. */
export const HH_SHIP_VIA_UI_PREVIEW_SOURCE = 'ui-preview-ship-via';

export type HhShipViaCode = typeof HH_SHIP_VIA_DEFAULT | typeof HH_SHIP_VIA_USPS_PRIORITY;
export type HhShipViaOverride = '' | 'default' | 'usps';

export interface HhShipViaChoice {
  code: HhShipViaCode;
  /** Why this address would use USPS Priority. Empty when Default is the automatic choice. */
  reason: string;
}

const MILITARY_STATES = new Set(['AA', 'AE', 'AP']);
const MILITARY_CITIES = new Set(['APO', 'FPO', 'DPO']);

export interface HhShipViaAddress {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
}

function poBox(line: string): boolean {
  return /\bP\.?\s*O\.?\s*BOX\b/i.test(line);
}

/** Alaska, Hawaii, APO/FPO/DPO, and PO Boxes use USPS Priority Post Billable. */
export function hhAutomaticShipVia(address: HhShipViaAddress): HhShipViaChoice {
  const state = (address.state ?? '').trim().toUpperCase();
  const city = (address.city ?? '').trim().toUpperCase();
  if (poBox(address.line1 ?? '') || poBox(address.line2 ?? '')) {
    return { code: HH_SHIP_VIA_USPS_PRIORITY, reason: 'PO Box' };
  }
  if (state === 'AK' || state === 'ALASKA') return { code: HH_SHIP_VIA_USPS_PRIORITY, reason: 'Alaska address' };
  if (state === 'HI' || state === 'HAWAII') return { code: HH_SHIP_VIA_USPS_PRIORITY, reason: 'Hawaii address' };
  if (MILITARY_STATES.has(state) || MILITARY_CITIES.has(city)) {
    return { code: HH_SHIP_VIA_USPS_PRIORITY, reason: 'APO address' };
  }
  return { code: HH_SHIP_VIA_DEFAULT, reason: '' };
}

export function hhShipViaForDraft(address: HhShipViaAddress, override: HhShipViaOverride): HhShipViaChoice {
  const auto = hhAutomaticShipVia(address);
  if (override === 'default') return { code: HH_SHIP_VIA_DEFAULT, reason: auto.reason };
  if (override === 'usps') {
    return auto.code === HH_SHIP_VIA_USPS_PRIORITY ? auto : { code: HH_SHIP_VIA_USPS_PRIORITY, reason: 'Chosen for this order' };
  }
  return auto;
}

export function isHhShipViaOverride(value: unknown): value is HhShipViaOverride {
  return value === '' || value === 'default' || value === 'usps';
}
