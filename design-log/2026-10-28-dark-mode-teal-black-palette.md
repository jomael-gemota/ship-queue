# Dark Mode — Teal-on-Black Palette

**Date:** 2026-10-28
**Status:** accepted — supersedes [2026-10-28-dark-mode-charcoal-palette](./2026-10-28-dark-mode-charcoal-palette.md)
**Author:** collaborative

## Context

After the initial charcoal-gray dark mode, the team selected a richer
teal-on-black palette from a custom swatch set. The goal is a modern,
professional look with stronger visual identity than neutral gray.

Source swatches:
| Name | Hex |
|---|---|
| Light Detroit | `#CEDADB` |
| Water Music | `#6DADBE` |
| Alpine Landing | `#12768A` |
| Bovine | `#515C5C` |
| Ghostlands Coal | `#0B3F43` |
| Eight Ball | `#030A0A` |

## Decision

### CSS tokens (`frontend/src/index.css` — `.dark` block)

| Token | Value | Source swatch | Role |
|---|---|---|---|
| `--bg-100` | `#030a0a` | Eight Ball | Main page background |
| `--bg-200` | `#0e2527` | — (between Eight Ball + Coal) | Elevated: alt rows, table headers |
| `--bg-300` | `#515c5c` | Bovine | Borders / dividers |
| `--text-100` | `#cedadb` | Light Detroit | Primary text |
| `--text-200` | `#6dadbe` | Water Music | Secondary / muted text |
| `--accent-100` | `#12768a` | Alpine Landing | Row handles, icon accents |
| `--accent-200` | `#cedadb` | Light Detroit | Active nav text, row-hover accent stripe |
| `--primary-100` | `#0d5060` | — (lifted above Coal) | Hover / active background |
| `--primary-200` | `#12768a` | Alpine Landing | Theme-toggle active pill, elevated interactive |
| `--primary-300` | `#515c5c` | Bovine | Muted / disabled tones |

### Sidebar (`frontend/src/components/Sidebar.tsx`)

The sidebar gets its own distinct background (`#0B3F43` — Ghostlands Coal)
separate from the main content area (`#030A0A`). This creates clear
chrome/content separation — a common pattern in modern tools (Linear, Notion).

Internal sidebar borders use `#1a4f53` (a mid-point between Coal and Alpine
Landing) so they are visible without being harsh.
The logo container uses `var(--bg-100)` (near-black) so it reads as a
crisp dark badge against the teal sidebar.

## Alternatives Considered

- **Apply Coal to bg-200 broadly** — would make alternating table rows very
  visibly teal, which felt too busy in a data-dense table view.
- **Hardcode sidebar to its own token** — unnecessary; a direct arbitrary
  Tailwind class (`dark:bg-[#0b3f43]`) is simpler and explicit.

## Consequences

- All pages, tables, drawers, and modals inherit the teal-on-black theme
  through CSS variable cascading.
- Sidebar has a visually distinct teal chrome that differentiates navigation
  from content — no component other than `Sidebar.tsx` changed.
- Light mode remains completely unaffected.
- Status/notice-card colours remain hardcoded (red, green, yellow, blue) —
  they are purposefully colorful for legibility.
