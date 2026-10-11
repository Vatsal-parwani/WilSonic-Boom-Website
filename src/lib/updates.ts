// Updates live as Markdown files in src/content/updates/, one file each, written
// in the admin. A file marked `draft: true` shows in `npm run dev` only.

interface Front {
  title: string; date: string | Date; author?: string; summary?: string;
  cover?: string | null; draft?: boolean;
}
export interface Post {
  slug: string; title: string; date: string; author: string; summary: string;
  cover: string | null; draft: boolean;
  html: () => Promise<string>;   // the article, rendered
}

const files = import.meta.glob<{ frontmatter: Front; compiledContent: () => string | Promise<string> }>(
  '../content/updates/*.md', { eager: true },
);

// The admin stores pictures and links as site-relative paths ("/images/…").
// Served under a sub-path, they need it in front, like every link in the templates.
const base = import.meta.env.BASE_URL.replace(/\/$/, '');
const withBase = (html: string) => (base ? html.replace(/\b(src|href)="\/(?!\/)/g, `$1="${base}/`) : html);

// YAML reads an unquoted 2026-10-09 as a Date; keep everything as YYYY-MM-DD text
const iso = (d: string | Date) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

export const posts: Post[] = Object.entries(files)
  .map(([path, m]) => ({
    slug: path.split('/').pop()!.replace(/\.md$/, ''),
    title: m.frontmatter.title,
    date: iso(m.frontmatter.date),
    author: m.frontmatter.author ?? '',
    summary: m.frontmatter.summary ?? '',
    cover: m.frontmatter.cover || null,
    draft: Boolean(m.frontmatter.draft),
    html: async () => withBase(await m.compiledContent()),
  }))
  .filter((p) => import.meta.env.DEV || !p.draft)
  .sort((a, b) => b.date.localeCompare(a.date));

export const longDate = (d: string) =>
  new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
