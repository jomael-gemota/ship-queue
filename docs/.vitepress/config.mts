import { defineConfig } from 'vitepress'

// The guide is served from the same origin as the app at /docs. It builds to
// the VitePress default location (docs/.vitepress/dist); the `docs:build` npm
// script then copies that output into frontend/dist/docs, where the existing
// express.static middleware (src/index.ts) serves it automatically. We copy
// rather than set `outDir` outside the project root because doing so trips a
// VitePress manifest-resolution bug during the page-rendering step.
//
// Note: the root package is CommonJS, so this config uses the .mts extension so
// VitePress (ESM-only) can load it as an ES module.
export default defineConfig({
  title: 'Ship Queue Guide',
  description: 'A simple, step-by-step guide to using Ship Queue.',
  base: '/docs/',
  lang: 'en-US',
  cleanUrls: false,
  // Skip realpathSync during the build's page-rendering step. On Windows it can
  // canonicalize the drive letter (c: -> C:) so the page chunk lookup misses and
  // the build crashes with "Cannot read properties of undefined (reading 'imports')".
  vite: { resolve: { preserveSymlinks: true } },
  head: [['link', { rel: 'icon', href: '/docs/ship-queue-logo.svg' }]],
  themeConfig: {
    logo: '/ship-queue-logo.svg',
    siteTitle: 'Ship Queue Guide',
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'About', link: '/about' },
    ],
    sidebar: [
      {
        text: 'Getting Started',
        items: [
          { text: 'Welcome', link: '/' },
          { text: 'Signing In & Getting Around', link: '/guide/getting-started' },
        ],
      },
      {
        text: 'Using Ship Queue',
        items: [
          { text: 'Viewing Orders', link: '/guide/orders' },
          { text: 'Creating Shipping Labels', link: '/guide/create-label' },
          { text: 'Dropbox Fetcher', link: '/guide/dropbox-fetcher' },
          { text: 'Settings', link: '/guide/settings' },
          { text: 'User Management', link: '/guide/user-management' },
        ],
      },
      {
        text: 'Help',
        items: [
          { text: 'FAQ & Troubleshooting', link: '/guide/faq' },
          { text: 'About', link: '/about' },
        ],
      },
    ],
    search: { provider: 'local' },
    outline: { level: [2, 3], label: 'On this page' },
  },
})
