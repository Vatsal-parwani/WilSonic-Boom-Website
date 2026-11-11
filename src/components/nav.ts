// The pages, in nav order. `key` is what a page passes to the layout
// as `current`, which sets aria-current on the matching link.
export const NAV = [
  { key: 'robot', label: 'Robot', href: '/robot/' },
  { key: 'achievements', label: 'Achievements', href: '/achievements/' },
  { key: 'team', label: 'Team', href: '/team/' },
  { key: 'outreach', label: 'Outreach', href: '/outreach/' },
  { key: 'awards', label: 'Awards', href: '/awards/' },
  { key: 'updates', label: 'Updates', href: '/updates/' },
  { key: 'sponsors', label: 'Sponsors', href: '/sponsors/' },
] as const;

export type NavKey = (typeof NAV)[number]['key'] | 'home' | 'sponsor';

// The gold button: the pitch to a new sponsor. Deliberately not in NAV -
// /sponsors is who already supports us; this is how to become one.
export const SPONSOR_CTA = { key: 'sponsor', label: 'Sponsor the team', href: '/sponsor-the-team/' } as const;