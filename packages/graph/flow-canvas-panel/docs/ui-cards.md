# Node card visual polish

Date: 2026-10-18 · Panel `0.1.13` · Echo demo `0.1.5`

Scope: the node card itself, the edges that touch it, and the status visuals
that read with it. Layout structure (left-to-right ranking, pan/zoom, inspector
drawer) is unchanged from `0.1.11`; `0.1.13` tightens the card outline and port
contrast without changing the card anatomy.

## Goal

Make the row read like nodes from a mature flow editor (n8n / Dify / Coze), not
like small form cards: one strong title, one status accent, one quiet subtitle,
one consistent type glyph, and edges that visibly leave and enter ports.

## Before / after

1440×900, same flows. "Before" is the `0.1.11` card (`ui-card-before`, copied
from the earlier `ui-after` set); "after" is `0.1.13` (`ui-card-after`).

| Before | After |
|---|---|
| ![Before: settled](ui-card-before/after-settled.png) | ![After: settled](ui-card-after/after-settled.png) |
| ![Before: approval](ui-card-before/after-approval-card.png) | ![After: approval](ui-card-after/after-approval-card.png) |
| ![Before: selected output](ui-card-before/after-output.png) | ![After: selected output](ui-card-after/after-output.png) |
| ![Before: approved](ui-card-before/after-approval-approved.png) | ![After: approved](ui-card-after/after-approval-approved.png) |
| ![Before: fit](ui-card-before/after-zoom-fit.png) | ![After: fit](ui-card-after/after-zoom-fit.png) |

Additional after evidence:

- `ui-card-after/after-zoom-in.png` — 126% zoom; text and 1px strokes stay
  crisp.
- `ui-card-after/after-dark-settled.png` and `after-dark-approval.png` — the
  same cards under the host dark theme.

## Border fix (0.1.13)

The 0.1.12 cards used `border-l2` (light `rgba(0,0,0,0.10)`, dark
`rgba(255,255,255,0.12)`) with `shadow-lv1`. At fit zoom (~82%) the 1px computed
border scaled below one device pixel and, especially in dark mode, the card
merged into the canvas.

0.1.13 uses `border-l4` (light `rgba(0,0,0,0.16)`, dark
`rgba(255,255,255,0.20)`) at `1px`, keeps `shadow-lv1` for depth, and adds a
clear hover outline: `30% business + border-l4`. Selected keeps the 2px
business ring and now also gets an 8% business background tint, so selected and
keyboard focus are distinguishable. Always-on port dots use
`label-tertiary` and larger radii (3.5px source / 3px target).

| Light 82% | Light 100% |
|---|---|
| ![Before 82% light](ui-borders-before/before-82-light.png) | ![Before 100% light](ui-borders-before/before-100-light.png) |
| ![After 82% light](ui-borders-after/after-82-light.png) | ![After 100% light](ui-borders-after/after-100-light.png) |

| Dark 82% | Dark 100% |
|---|---|
| ![Before 82% dark](ui-borders-before/before-82-dark.png) | ![Before 100% dark](ui-borders-before/before-100-dark.png) |
| ![After 82% dark](ui-borders-after/after-82-dark.png) | ![After 100% dark](ui-borders-after/after-100-dark.png) |

Hover and selected evidence: `ui-borders-after/after-hover-light.png`,
`after-hover-dark.png`, `after-selected-light.png`.

## Card anatomy

```
┌─┬─────┬─────────────────────────────┐
│ │icon │ title                  status│  ← 13.5px/600 · 12px/600, accent
│ │28px │ subtitle                      │  ← 11.5px/400, tertiary
└─┴─────┴─────────────────────────────┘
 ↑ 3px status rail (the only status colour on the card)
```

| Rule | Value |
|---|---|
| Card | `184 × 72`, radius `--dsw-radius-md` (12px), 1px `border-l4`; status cards use the same border contrast |
| Padding | `9px 12px 9px 15px` (extra left space for the rail) |
| Gap | icon↔body `9px`; title↔subtitle `4px`; title↔status `8px` |
| Icon | `28 × 28`, radius `--dsw-radius-sm` (8px), 16px inline SVG glyph |
| Rail | `3px` wide, radius follows the card; status colour only |
| Title | 13.5px / 600 / primary; one line with ellipsis |
| Status | 12px / 600 / accent colour; right-aligned with the title |
| Subtitle | 11.5px / 400 / tertiary; type name when no detail, otherwise the error code, skip reason or approval hint |
| Type | one small glyph + hover title; no full type row and no pill |

The subtitle is deliberately a single line. Full error text, policy, retry,
duration and approval audit stay in the inspector.

## Status palette

| State | Accent / rail | Notes |
|---|---|---|
| pending | `label-tertiary` / `label-dimmed` | quiet; no colour competition |
| ready | `state-business-primary` | ready to run |
| running | `state-business-primary` | only the rail pulses (1.8s opacity, reduced-motion aware) |
| awaiting approval | `state-warn-label` / `state-warn-primary` | amber; the approval dock owns the action |
| completed | `state-success-primary` | green |
| recovered | `state-warn-label` / `state-warn-primary` | amber, label `已兜底`; not a clean success |
| failed | `state-error-primary` | red |
| skipped / cancelled | `label-tertiary` / `label-dimmed` | muted icon/rail, text still readable |

The card border stays neutral in every state. Status appears exactly twice: the
left rail and the status word. There is no third border colour and no status
icon.

## Edges and ports

- Every edge starts at a visible source port dot and ends at a target port dot
  (SVG circles, 3.5px / 3px, 1.5px stroke, filled with the container layer;
  always-on edges use `label-tertiary`, conditional edges use their tone).
- Edges are cubic Béziers; the line leaves the card's right edge and enters the
  target's left edge with a clear arrowhead (marker size 7).
- Conditional edges keep their semantic colour: port = business blue, predicate
  = amber, error-branch default = red and dashed `6 5`.
- Edges whose target never executed (`skipped` / `cancelled`) become muted
  **dotted** `2 5` lines with muted labels. This is intentionally different from
  the dashed error-branch default: dashed = "closes on error", dotted = "this
  branch did not run".
- Labels are 21px rounded rectangles (radius 6, 11.5px/500), token border/text
  and a host shadow; they are placed at the curve midpoint with collision
  avoidance against nodes and other labels.

## Theme and interaction

Everything is derived from host CSS variables:

`--dsw-alias-bg-layer-1/2`, `--dsw-alias-border-l1/l2/l3`,
`--dsw-alias-label-primary/secondary/tertiary`,
`--dsw-alias-interactive-bg-hover`,
`--dsw-alias-state-{business,success,warn,error}-primary`,
`--dsw-alias-state-warn-label`, `--dsw-alias-state-warn-primary`,
`--dsw-shadow-lv1/lv2`, `--dsw-radius-sm/md`,
`--dsw-focus-ring-width/--dsw-focus-ring-color`.

- Hover: layer-2 background, `30% business + border-l4` outline + shadow-lv2;
  no movement.
- Focus-visible: 2px focus ring with 2px offset (no background tint).
- Selected: 2px business outline with 2px offset **plus an 8% business background
  tint**, so it is distinct from keyboard focus and from hover; the outline uses
  the business token directly, not the focus-ring variable, so a host
  "no focus ring" preference never hides selection.
- Active: `--dsw-alias-interactive-bg-hover`.
- Disabled: 55% opacity, no shadow, default cursor.
- Icons are inline SVG; no icon font, CDN, emoji or external asset.
- No gradients, glow, 3D transforms, or colour-coded type icons. Those would
  compete with the status rail and the approval dock.

## Verification

- `pnpm --dir packages/graph/flow-canvas-panel test`: 58 passed.
- `pnpm --dir packages/graph/flow-canvas-node-echo test`: 2 passed.
- All 12 graph packages: 230 specs passed.
- Typecheck: panel and echo packages clean.
- Real browser: same temporary isolated node and `docs/e2e-ui.mjs` as the
  previous round; the script also captures 126%, 100%, fit, dark settled and
  dark approval at 1440×900. `after-zoom-100.png` is the 100% readability check;
  `after-dark-*.png` is the theme check.
- Border walkthrough: `docs/e2e-borders.mjs` captures 82%/100% light/dark,
  hover and selected at 1440×900 and logs the computed border/shadow. Before:
  `1px rgba(0,0,0,0.10)` / `rgba(255,255,255,0.12)` + `shadow-lv1`; after:
  `1px rgba(0,0,0,0.16)` / `rgba(255,255,255,0.20)`; hover computes to a
  41%-alpha blue-gray outline; selected adds the 8% tint plus the 2px ring.
- 3080 and `~/.dsh` were not touched; the temporary node was removed.

## Deliberately not done

- No node dragging, handles, multi-select, minimap, or layout persistence
  (outside the layout scope of this round).
- No per-type colour coding: type is a neutral glyph, status owns colour.
- No glow, gradient, 3D card, large illustration or animated graph.
- No icon font or CDN.
- No per-node progress ring; the running rail pulse is the only motion.

## Designer check

The row now has a clear visual grammar: type glyph, title, status accent,
subtitle. It no longer reads as a form card, and the edges visibly connect ports
instead of floating between boxes. The border fix uses the strongest neutral
host border layer (`border-l4`) and leaves status colour on the rail, so the
cards have an unmistakable edge without becoming heavy or glowing. At 100% the
text is crisp; the six-node fit view (≈82%) is smaller by construction, and the
user can zoom or fit. I would call this production-ready for a read-only run
canvas; the only remaining compromise is that fitting the entire six-node graph
necessarily scales text down.
