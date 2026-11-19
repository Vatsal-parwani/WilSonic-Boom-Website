// Current sponsors, grouped by the five tiers in the sponsorship pack.
// Order and names come from `tiers` in sponsors.json; the highest tier leads.
import data from '../data/sponsors.json';
import { checkLogo } from './logo-size';

export type Sponsor = (typeof data.sponsors)[number];

// highest first: diamond, platinum, gold, silver, bronze
export const tierOrder = [...data.tiers].reverse().map((t) => t.key);
export const tierName = (key: string) => data.tiers.find((t) => t.key === key)?.name ?? key;
const rank = (s: Sponsor) => {
  const i = tierOrder.indexOf(s.tier);
  return i === -1 ? tierOrder.length : i;
};

// the two top tiers get the large card and the largest logos
export const isHeadline = (s: Sponsor) => rank(s) < 2;

// every logo is checked once, when the site is built
for (const s of data.sponsors) checkLogo('logo' in s ? s.logo : undefined, s.name);

// A sponsor with an `until` season has stopped; they keep their place on
// /sponsors under "Previously", and drop out of the strip on every page.
export const isPast = (s: Sponsor) => Boolean((s.until ?? '').trim());

export const sponsorList = [...data.sponsors]
  .filter((s) => !isPast(s))
  .sort((a, b) => rank(a) - rank(b));

export const pastSponsors = [...data.sponsors]
  .filter(isPast)
  .sort((a, b) => (b.until ?? '').localeCompare(a.until ?? '') || rank(a) - rank(b));

export const byTier = tierOrder
  .map((key) => ({ key, name: tierName(key), sponsors: sponsorList.filter((s) => s.tier === key) }))
  .filter((g) => g.sponsors.length > 0);
