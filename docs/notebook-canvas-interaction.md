# notebook canvas interaction spec + spike report

> Status: **implemented, shipped with 4.0.0-rc.3**. Task book: docs/notebook-canvas-expiry-task.cn.md (the D-series rulings live in its §3).
> **Real-machine user rulings (2026-11-03)**: ① "all canvas, no editor" — canvas mode is full-bleed, the permanent editor column removed, list mode kept as the index/accessible equivalent; ② "node relations as nodes and edges" — edges must be visible; ③ "no blank margins" — every width cap removed, the panel spans full width; ④ **"wrong tech stack: never absolutely-positioned DOM cards, use a professional canvas library"** — the renderer moved from absolutely-positioned DOM to Konva (a Canvas2D scene graph), see §7.
> Real-machine acceptance numbers live in docs/acceptance/notebook-4.0.0-rc.2/; rc.3's renderer acceptance rests on the package's unit tests plus a real-Chrome preview harness (§7.4).

## 1. State machines

### 1.1 The canvas has no selection face (ruling: the canvas is not an editor)

The canvas re-arranges and highlights only — it never selects and never edits: clicking a card produces no selection, clicking empty space opens no inspector. Selection and editing live entirely in list mode (list row → editor seat → links sections).

Rationale: the canvas is the "see the relations" face; editing is the "change one card" face. Sharing one coordinate system makes every drag first answer "is this a re-arrange or a select?", and the gestures swallow each other.

### 1.2 Viewport state machine

```
[initial] --layout+size ready--> [opening view] (once per viewKey=owner: 0.85 zoom on the hub centroid)
[opening/any] --wheel(cursor anchor)--> [zoom 0.25–2.0]
[any] --press on empty board→move ≥4px--> [pan] --release--> [previous]
[any] --toolbar +/− --> [center-anchored zoom ×1.25 / ×0.8]
[any] --toolbar "fit" --> [fit the whole drawing]
```

- The opening view is not "fit": the old fit-on-open squeezed nine cards to ~0.5, turning a 13px title into 6px on screen. Fit remains an explicit toolbar action.
- Panning is Konva's own stage drag (`stage.draggable(true)` + `dragDistance(4)`); the stage writes its position back into React's viewport state. A card group is draggable on its own, and Konva gives the inner draggable precedence, so grabbing a card never pans the board.
- The press itself is claimed by the gesture arbiter (`canvas-gesture.ts`): cancelling the browser's default gestures so a pan never paints a text selection or starts a native drag; touch keeps the browser's own gestures.

### 1.3 Edge hover state machine

```
[no hover] --pointer enters an edge's 12px hit stroke--> [hover edge i]
[hover edge i] --both endpoints lit, neighborhood kept, other nodes .3 / other edges .18 --> --pointer leaves--> [no hover]
```

- The hit face is the canvas path's `hitStrokeWidth: 12`; the ink is 1.6px. One and the same Bézier carries both hit and paint, so the hit face can never drift from the ink.

## 2. Anatomy

### 2.1 Card node (176×84px; zoning geometry comes from canvas-layout)

```
┌──────────────────────────┐
│ [fleeting|permanent|project] ⟲3 │  kind chip + inbound badge (only when >0)
│ title (13px, one line)           │
│ excerpt (10.5px, two lines)      │  no excerpt → no band
│ 2d left / 1d overdue             │  only cards with expiresAt; overdue in red
└──────────────────────────┘
```

- A card is one Konva Group: rounded body, optional project bar, kind chip (a pill sized to its measured label), inbound badge, title, excerpt and aging line are all scene-graph nodes.
- Hover/dim: nodes outside the neighborhood `opacity .3`, unrelated edges `.18`.
- Project cards carry a 3px success bar on the left; fleeting cards are filled with accent-soft at 30% over surface; overdue cards get a dashed stroke and red ink.

### 2.2 Edges

- Ink 1.6px (accent mixed with border), a quadratic Bézier bent along the chord's normal (`edgePath`; deterministic and order-free like the layout) so two chords never cross in an X at the centre.
- 12px hit stroke; hovering lights the neighborhood.

### 2.3 Zoning (canvas-layout's domain geometry)

```
            ┌─ hub ring (inbound>0, innermost)
   graph ├─ outflow ring (outbound only)
            └─ island ring (no links at all, outermost — the audit's reveal band)
────────────────────────────────
   intake strip (4-column grid): overdue first (top-left), fresh after   ← fleeting never joins the graph
```

## 3. Density ladder (D6)

| Cards | Form |
|---|---|
| ≤30 | full detail (title + two-line excerpt + badges) — the default 0.85 opening tier; today's real box has 9 cards here |
| 31–150 | unchanged this round (the layout already widens rings by arc length); LOD-driven culling stays P1 |
| >150 | drawable this round (200-card synthetic passes, bounds 5258×6758); coarse tier stays P1 |

The 0.85 tier is “full detail”: card titles are 13px, which is 11.05px on screen and readable without any gesture; Fit is an explicit action, not the default readability strategy.

## 4. Theme tokens (Konva has no CSS inheritance, so the live document is read)

| Canvas element | Source |
|---|---|
| card/canvas background | `--nb-surface` → `--dsw-alias-bg-layer-1` |
| edge ink | `--nb-accent` mixed 62% with `--nb-border` (`mixColor`) |
| kind chip fill | `--nb-sunken` |
| overdue ink/frame | `--nb-danger` |
| project bar | `--nb-success` |
| card shadow | `--nb-text` at 8% alpha (`withAlpha`) |
| fleeting fill | `color-mix(in srgb, var(--nb-accent-soft) 30%, var(--nb-surface))`, resolved by the probe |

`canvas-theme.ts` appends a hidden probe inside the page, writes `var(--nb-*)` into a painted property, and reads `getComputedStyle`, so the browser resolves the whole alias chain (including `color-mix`). A `MutationObserver` on `body[data-ds-dark-theme]` and the root attributes rebuilds the palette when the shell switches themes. No color is hardcoded.

## 5. Spike report (2026-11-03, completed before the implementation)

- **Real data**: stable node `deepseek\.dsh/storages/notebook.json`, owner=standard: 13 cards (2 fleeting, 11 permanent, 0 project), 8 cached links, both fleeting cards already overdue.
- **S1 determinism**: same input twice + shuffled input → byte-identical `placed`. PASS
- **S2 zoning**: fleeting minFleetY=559 > maxGraphY=213.5 (strictly separated); hubs r=163 < outflow r=295 < islands r=427. PASS
- **S3 completeness**: 13 cards placed exactly once. PASS
- **S5 scale**: 200-card synthetic layout completes (5258×6758). PASS
- **Spike verdict**: the layout passes; no force-directed library needed (D4 stands).

## 6. Expiry semantics (D3 landing)

- Window: `freshness.fleetingWindowDays` (default 2, clamped to [1,365]); visibility only, rows are never deleted.
- `expiresAt = updatedAt + window`, derived at read time; cards / list rows / intake dock render from the same source.
- Exits: **promote** (dock or editor, one click, full write-time discipline) | **trash** (dock, two-click confirmation, `card-referenced` guard) | **edit** (saving refreshes `updatedAt` and renews freshness).
- No snooze, no timers, no automatic deletion (doctrine: docs/notebook-note-types.cn.md §2).

## 7. Renderer (rc.3)

### 7.1 Decision

The renderer is **Konva 10 (Canvas2D scene graph, MIT)**, imported per sub-path (`konva/lib/Stage`, `Layer`, `Group`, `shapes/Rect`, `shapes/Text`, `shapes/Path`) and inlined into the client bundle. No card is a DOM element any more.

### 7.2 Why it changed

- **DOM cards top out at the layout engine**: each card is a DOM box with text wrapping, border, shadow and `transition`, all inside one `transform: scale()` world; every drag frame re-lays out the subtree, and the first thing to collapse with more nodes is style resolution and compositing, not the canvas.
- **Hit testing**: DOM asked a selector (`closest('[data-canvas-node]')`) "what did I hit?"; canvas asks the library's hit canvas (one colorKey per shape), where z-order, opacity and stroke width all participate, and the priority of edges vs cards is the scene graph's order.
- **Text**: the library brings wrapping, ellipsis and line height; each line of the card anatomy gets an explicit text band (title 13px one line, excerpt 10.5px two lines, aging 10px) instead of DOM-only `-webkit-line-clamp`.
- **Gestures**: dragging (3px threshold), stage panning (4px threshold) and z-lifting (`moveToTop`) are first-class, so we no longer maintain pointer capture and z-index by hand.
- **Theme**: canvas has no CSS inheritance, so colors must be resolved explicitly (§4); on a theme switch the palette is rebuilt rather than waiting for the browser to repaint CSS variables.

### 7.3 Structure and responsibility

| File | Responsibility |
|---|---|
| `canvas-layout.ts` | pure geometry: zoning, rings, intake strip, bounds, Bézier path (no React, no Konva) |
| `canvas-card.ts` | one card's scene graph: body, project bar, kind chip, badge, title, excerpt, aging line |
| `canvas-scene.ts` | one layer holding the edge group and the card group; hover dimming and live edge re-routing |
| `canvas-theme.ts` | live theme → palette (hidden probe + MutationObserver) |
| `canvas-color.ts` | `rgb()`/hex parsing, arithmetic stand-ins for `color-mix` and alpha (pure) |
| `canvas-position-store.ts` | dragged positions: localStorage read/write, malformed entries dropped silently (pure) |
| `canvas-viewport-math.ts` | zoom bounds, fit view, opening view (pure) |
| `canvas-viewport-auto.ts` | React binding of that arithmetic: size, wheel zoom, opening view, zoom actions |
| `use-canvas-stage.ts` | Konva stage lifecycle: create/destroy, size, transform, scene rebuild, drag gestures, gesture arbitration |
| `canvas-stage.tsx` | the stage element itself (one div) |
| `canvas.tsx` | assembly: toolbar, stage, empty-box instruction card |

### 7.4 Acceptance

- Pure functions: `tests/canvas-{layout,color,positions}.spec.ts` (layout invariants, mixing/parsing, position round-trip and malformed-entry dropping).
- Interaction: an automated real-Chrome preview harness (same component, same `panel.css` + `canvas.css`, real theme CSS) — exactly one canvas element; dragging a card writes a rounded drop into `localStorage`; hovering an edge repaints the whole board (neighborhood dimmed); background-drag panning repaints; wheel zoom repaints; switching `body[data-ds-dark-theme]` repaints; zero page errors and zero console errors throughout.
- Accessibility: the stage is `aria-hidden`; list mode is the equivalent face (§1.1).

### 7.5 Cost

- The client bundle grew from ~105KB to ~449KB (Konva subset inlined, unminified). In exchange, node count is no longer bounded by DOM layout, and dragging/hit testing/text wrapping are guaranteed by the library.
- Text metrics follow the font: line height and ellipsis are measured by Konva at runtime, and a change to the theme's `--dsw-font-family` also rebuilds the palette (the font family lives in the palette).
