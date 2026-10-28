# Light Mode — Sky-and-Cream Palette

**Date:** 2026-10-29
**Status:** accepted — supersedes [2026-10-28-light-mode-sage-whisper-palette](./2026-10-28-light-mode-sage-whisper-palette.md)
**Author:** collaborative

## Context

The sage-whisper light palette is being replaced with a sky-and-cream palette
matching a reference finance dashboard (clean blue sidebar, cream/white content).

## Decision

### CSS tokens (`frontend/src/index.css` — `:root` block)

| Token | Value | Role |
|---|---|---|
| `--bg-100` | `#fffefb` | Main background — near-white cream |
| `--bg-200` | `#f5f4f1` | Secondary background — warm light gray |
| `--bg-300` | `#cccbc8` | Borders / dividers — warm gray |
| `--primary-100` | `#d4eaf7` | Hover / active bg — light sky blue |
| `--primary-200` | `#b6ccd8` | Elevated interactive, theme-toggle active pill |
| `--primary-300` | `#3b3c3d` | Muted mid-tone (disabled, placeholder) |
| `--accent-100` | `#71c4ef` | Row handles, icon accents — sky blue |
| `--accent-200` | `#00668c` | Buttons, active nav text — deep ocean blue |
| `--text-100` | `#1d1c1c` | Primary text — near-black |
| `--text-200` | `#313d44` | Secondary / muted text — blue-gray |

### Sidebar (`frontend/src/components/Sidebar.tsx`)

- `bg-[#62b5a0]` (teal) → `bg-[#00668c]` (ocean blue, matches `--accent-200`)
- All sidebar border hardcodes (`#4da08e`, `#7ecbb5`) → `border-white/20`
  (translucent white lines that look clean on the deep blue background)
- `html:not(.dark) [data-sidebar]` token overrides updated comment only;
  values adjusted to `rgba(255,255,255,0.75)` for text-200 for better contrast.

## Consequences

- All pages and components pick up the new light palette via CSS var cascade.
- Dark mode is completely unaffected.
- Workspace cards in light mode use `--primary-100` (`#d4eaf7`) as body bg,
  giving them a pleasant sky-blue tinted surface against the cream page.
