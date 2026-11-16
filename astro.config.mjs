// @ts-check
import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';

// On GitHub Pages the deploy workflow supplies the address and sub-path
// (.github/workflows/deploy.yml). Locally, and on hosts that serve from the
// root, both fall back to the defaults below.
export default defineConfig({
  integrations: [preact()],
  site: process.env.PAGES_SITE || 'https://wilsonicboom.com',
  base: process.env.PAGES_BASE || '/',
  trailingSlash: 'ignore',
  build: { format: 'directory' },
  // The dev toolbar only exists in `npm run dev`; off so it is never mistaken for the design.
  devToolbar: { enabled: false },
  // Local preview address: http://localhost:4188
  server: { port: 4188 },
});
