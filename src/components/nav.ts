import { posts } from '../lib/blog';

// The pages, in nav order. `key` is what a page passes to the layout
// as `current`, which sets aria-current on the matching link.
const PAGES = [
  { key: 'robot',    label: 'Robot',    href: '/robot/' },
  { key: 'season',   label: 'Season',   href: '/season/' },
  { key: 'team',     label: 'Team',     href: '/team/' },
  { key: 'outreach', label: 'Outreach', href: '/outreach/' },
  { key: 'blog',     label: 'Blog',     href: '/blog/' },
  { key: 'sponsors', label: 'Sponsors', href: '/sponsors/' },
] as const;
export type NavKey = (typeof PAGES)[number]['key'] | 'home' | 'sponsor';

// The blog joins the nav once it has an article in it; an empty blog is not
// worth a link. (Locally it always shows, so there is a way in to check it.)
export const NAV = PAGES.filter((p) => p.key !== 'blog' || posts.length > 0 || import.meta.env.DEV);

// The gold button: the pitch to a new sponsor. Deliberately not in NAV —
// /sponsors is who already supports us; this is how to become one.
export const SPONSOR_CTA = { key: 'sponsor', label: 'Sponsor the team', href: '/sponsor-the-team/' } as const;
