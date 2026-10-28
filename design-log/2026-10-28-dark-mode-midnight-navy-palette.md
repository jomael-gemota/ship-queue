# Dark Mode — Midnight Navy Palette

**Date:** 2026-10-28
**Status:** accepted — supersedes [2026-10-28-dark-mode-teal-black-palette](./2026-10-28-dark-mode-teal-black-palette.md)
**Author:** collaborative

## Context

The teal-on-black dark mode is being replaced with a midnight-navy palette,
styled after a reference dashboard (dark navy finance UI: "Hue Brew" wallet
dashboard) supplied by the team. Key traits of the reference:

- The sidebar shares the page background and is separated from content by a
  thin, low-contrast vertical divider — no distinct sidebar colour.
- Content sits in raised, slightly lighter navy cards with no heavy borders.
- Navigation items have square icon tiles; the active item's tile is a
  saturated navy blue, inactive tiles are the card surface colour.
- Pills/badges use a muted steel-blue fill with white text.
- Highlight accents (large figures, hover text) are a soft periwinkle.

## Decision

### CSS tokens (`frontend/src/index.css` — `.dark` block)

| Token | Value | Role |
|---|---|---|
| `--bg-100` | `#0f1c2e` | Page, navbar and sidebar background |
| `--bg-200` | `#1f2b3e` | Cards, table headers, alt rows, inactive nav tiles |
| `--bg-300` | `#374357` | Borders / dividers, hovered nav tiles |
| `--primary-100` | `#1f3a5f` | Hover / active background, active nav tile |
| `--primary-200` | `#4d648d` | Pills, theme-toggle active pill |
| `--primary-300` | `#acc2ef` | Highlight text (group-hover titles, empty-state icons) |
| `--accent-100` | `#3d5a80` | Primary buttons (white text ≈ 7:1), row handles |
| `--accent-200` | `#cee8ff` | Active nav icon, row-hover accent stripe, links |
| `--text-100` | `#ffffff` | Primary text |
| `--text-200` | `#e0e0e0` | Secondary / muted text |

### Sidebar (`frontend/src/components/Sidebar.tsx`)

- Dark mode drops the hardcoded teal (`#0b3f43` / `#1a4f53`) and uses
  `--bg-100` with `--bg-300` dividers, matching the reference.
- Nav icons are wrapped in a 28 px tile. In dark mode the tile is
  `--bg-200` (inactive), `--bg-300` (hover) or `--primary-100` (active,
  with `--accent-200` icon); the active row itself has no fill, only
  white label text — as in the reference. Light mode keeps its current
  full-row active highlight.
- The four duplicated NavLink class builders are consolidated into one
  helper so the tile styling lives in one place.

### Revision — making the full palette visible

The token swap alone rendered as essentially two colours: most cards, panels
and modals used `--bg-100` (same as the page), and the remaining tokens only
reached hairline borders and hover states. Fixes:

- **Raised surfaces** — 59 bordered, rounded containers (`div`/`section`
  with `bg-[var(--bg-100)]` and no dark override) now get
  `dark:bg-[var(--bg-200)]`, so cards and modals lift off the page as in the
  reference. Light-mode classes are unchanged.
- **Element roles** — an unlayered `.dark` block in `index.css` assigns the
  rest of the palette consistently:
  - Table headers: `--primary-100` fill, `--accent-200` text,
    `--primary-300` icons.
  - Bordered inputs / selects / textareas: inset `--bg-100` with `--bg-300`
    border, `--primary-300` on focus (transparent inline-edit fields untouched).
  - Checkboxes / radios: `--primary-300` accent colour.
  - Text selection: `--accent-100`; scrollbars: `--bg-300` on `--bg-100`;
    `color-scheme: dark` for native date pickers and dropdowns.
- **Workspace tabs** (Doc Tidy) — active tab is a `--primary-100` tab with a
  `--primary-300` underline and white label; inactive tabs hover to `--bg-200`.
- **Labels** — sidebar section headings and the navbar platform label use
  `--primary-300`.

## Alternatives Considered

- **Token swap only** — would leave the teal sidebar and not reflect the
  reference's icon-tile navigation.
- **Gradient "hero" card (primary-100 → primary-200)** like the reference's
  balance card — no equivalent hero metric exists in Ship Queue pages, so it
  was not introduced.

## Consequences

- All pages, tables, drawers and modals pick up the navy palette through the
  existing `var(--*)` tokens; no page components change.
- Light mode is unaffected (sidebar tile classes are `dark:`-only apart from
  a neutral 28 px icon box).
- Status / notice-card colours remain hardcoded for legibility.
