# Light Mode — Sage Whisper Palette

**Date:** 2026-10-28
**Status:** accepted
**Author:** collaborative

## Context

The original light mode used a blue-gray palette (`#fffefb` bg, `#00668c` accent).
The team selected the "Sage Whisper" swatch set for a calmer, more natural feel
that pairs well with the teal-on-black dark mode.

Source swatches:
| Hex | Tone |
|---|---|
| `#F8FAF7` | Near-white with subtle green tint |
| `#F2F5F0` | Lightest sage |
| `#E2EBE0` | Light sage |
| `#C8D8C5` | Medium sage |

## Decision

### CSS tokens (`frontend/src/index.css` — `:root` block)

| Token | Value | Role |
|---|---|---|
| `--bg-100` | `#f8faf7` | Main page background |
| `--bg-200` | `#f2f5f0` | Secondary background (cards, sidebar in light mode) |
| `--bg-300` | `#c8d8c5` | Borders / dividers |
| `--primary-100` | `#e2ebe0` | Hover / active background |
| `--primary-200` | `#c8d8c5` | Elevated interactive, active pill |
| `--primary-300` | `#4a6a4a` | Muted / disabled tones |
| `--accent-100` | `#8aad87` | Subtle icon accents, row handles |
| `--accent-200` | `#3a6e3e` | Buttons, active nav text — forest green |
| `--text-100` | `#1a2e1a` | Primary text — near-black with forest tint |
| `--text-200` | `#4a6450` | Secondary / muted text — dark sage |

`--accent-200` (`#3a6e3e`) was chosen as the CTA / button colour: it achieves
≈ 5.3:1 contrast ratio against white text, passing WCAG AA.

## Alternatives Considered

- **Keep original blue accent** — rejected; forest green is more cohesive
  with the sage background family.
- **Use medium sage for text** — rejected; mid-greens (#8aad87) lack
  sufficient contrast for body text.

## Consequences

- All pages, tables, sidebar, and buttons inherit the sage palette in light mode.
- Dark mode is completely unaffected.
- Status/notice cards use hardcoded colors and remain unchanged.
