import { fetchSellerCentralOutdoorEquippedUs } from './jars/seller-central-outdoor-equipped-us';
import { SELLER_CENTRAL_OE_US_KEY } from '../models/CookieJar';

/** Returns the cookie string to persist. Throw on failure. */
export type CookieFetcher = () => Promise<string>;

/**
 * Code-owned fetchers. Adding a new *kind* of cookie job means adding a function
 * here and seeding a CookieJar row whose `key` matches. Schedule / enabled live
 * in Mongo, not in this map.
 */
export const fetchers: Record<string, CookieFetcher> = {
  [SELLER_CENTRAL_OE_US_KEY]: fetchSellerCentralOutdoorEquippedUs,
};

export function getFetcher(key: string): CookieFetcher | undefined {
  return fetchers[key];
}
