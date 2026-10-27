# Dark Mode — Charcoal Palette

**Date:** 2026-10-28
**Status:** accepted
**Author:** collaborative

## Context

The original dark theme used a navy/steel-blue palette
(`#0f1c2e` background, `#cee8ff` accent, etc.).
The team requested a neutral charcoal-gray look that feels less "branded"
and is easier on the eyes during extended sessions.

## Decision

Replace all nine CSS custom property values inside the `.dark` block in
`frontend/src/index.css` with the following charcoal palette:

| Token | Value | Role |
|---|---|---|
| `--bg-100` | `#121212` | Main page background |
| `--bg-200` | `#1a1a1a` | Secondary bg (cards, table headers) |
| `--bg-300` | `#444444` | Borders / dividers |
| `--text-100` | `#e0e0e0` | Primary text |
| `--text-200` | `#b0b0b0` | Secondary / muted text |
| `--accent-100` | `#888888` | Row handles, icon accents |
| `--accent-200` | `#888888` | Active-nav text, row-hover accent border |
| `--primary-100` | `#1e1e1e` | Hover / active background |
| `--primary-200` | `#2c2c2c` | Elevated surfaces, theme-toggle active pill |
| `--primary-300` | `#555555` | Muted mid-tone (disabled, placeholder) |

Because every component references `var(--*)` tokens, a single change
in `index.css` propagates to the entire UI.

## Alternatives Considered

- **Keep the blue-navy palette** — rejected; team wanted a neutral look.
- **Introduce separate component-level variables** — unnecessary overhead;
  the existing token system is sufficient.

## Consequences

- All pages, sidebar, navbar, tables, and modals automatically inherit the
  charcoal palette in dark mode.
- Light mode is unaffected.
- Status/notice-card colours (error red, success green, etc.) use
  hardcoded `rgb()` values and are unchanged — they remain purposefully
  colorful for legibility.
