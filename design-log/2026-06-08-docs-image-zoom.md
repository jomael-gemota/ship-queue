# Click-to-zoom screenshots in the user guide

**Date:** 2026-06-08
**Status:** accepted
**Author:** collaborative

## Context

The guide (see [2026-06-06-user-guide-vitepress.md](./2026-06-06-user-guide-vitepress.md))
embeds many product screenshots. At page width the fine detail (buttons,
toggles, table columns) is hard to read. Users need to enlarge a screenshot to
full screen to see what a step is pointing at.

VitePress has no built-in image zoom.

## Decision

Add click-to-zoom via the **medium-zoom** library, wired into the custom theme
(`docs/.vitepress/theme/index.ts`):

- In the theme `setup()`, attach medium-zoom to `.vp-doc img:not(a img)` on
  mount and re-attach after every in-app route change (VitePress is an SPA, so
  navigation does not re-run `onMounted`). The selector targets only images
  inside rendered markdown, leaving the logo, hero image, and feature-card
  icons untouched, and skips images wrapped in links.
- `custom.css` adds a `cursor: zoom-in` affordance and keeps the fullscreen
  overlay above VitePress's sticky nav (`z-index`).
- `medium-zoom` added as a root devDependency (docs build at repo root).

## Alternatives Considered

- **Custom Vue lightbox component / markdown-it plugin:** more code to maintain
  for the same result; medium-zoom is the well-trodden VitePress recipe.
- **Native `<dialog>`/CSS-only modal:** would require wrapping every image in
  markup and lose smooth zoom animation and ESC/scroll-to-close behavior.

## Consequences

- One small runtime dependency bundled into the docs client.
- Works under the relaxed `/docs` CSP from
  [2026-06-08-docs-csp-inline-scripts.md](./2026-06-08-docs-csp-inline-scripts.md);
  medium-zoom's inline element styles are allowed by Helmet's default
  `style-src 'unsafe-inline'`.
