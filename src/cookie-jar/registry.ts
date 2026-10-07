import { fetchHellyHansenSportsB2b } from './jars/b2b-hhsportswear';
import { fetchHellyHansenWorkB2b } from './jars/b2b-hhworkwear';
import { fetchThorogoodB2b } from './jars/b2b-thorogood';
import { fetchSellerCentralOutdoorEquippedUs } from './jars/seller-central-outdoor-equipped-us';
import {
  HELLY_HANSEN_SPORTS_B2B_KEY,
  HELLY_HANSEN_WORK_B2B_KEY,
  SELLER_CENTRAL_OE_US_KEY,
  THOROGOOD_B2B_KEY,
} from '../models/CookieJar';

/** Returns the cookie string to persist. Throw on failure. */
export type CookieFetcher = () => Promise<string>;

/**
 * Code-owned fetchers. Adding a new *kind* of cookie job means adding a function
 * here and seeding a CookieJar row whose `key` matches. Schedule / enabled live
 * in Mongo, not in this map.
 */
export const fetchers: Record<string, CookieFetcher> = {
  [SELLER_CENTRAL_OE_US_KEY]: fetchSellerCentralOutdoorEquippedUs,
  [HELLY_HANSEN_SPORTS_B2B_KEY]: fetchHellyHansenSportsB2b,
  [HELLY_HANSEN_WORK_B2B_KEY]: fetchHellyHansenWorkB2b,
  [THOROGOOD_B2B_KEY]: fetchThorogoodB2b,
};

export function getFetcher(key: string): CookieFetcher | undefined {
  return fetchers[key];
}
