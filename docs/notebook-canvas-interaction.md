# Notebook Canvas Interaction Spec + Spike Report

> Status: **implemented, shipping with 4.0.0-rc.2**. Task book: docs/notebook-canvas-expiry-task.md (the D rulings in its §3).
> **Three real-machine user rulings (2026-11-03, overriding D2's default form, all implemented)**: ① "all canvas, no editor" — canvas mode is full-bleed, the permanent editor column removed, the selected card shown in a floating inspector (top-left, × to close); ② "node relations as nodes and edges" — edges must be visible (explicit SVG viewport); ③ "no blank margins" — all width caps removed, the panel spans full width. The list mode stays as the index/accessible equivalent face.
> This file combines P0 deliverable 2 (the interaction spec) with deliverable 1 (the spike report); the real-machine numbers live in the rc.2 acceptance report under docs/acceptance/notebook-4.0.0-rc.2/.

## 1. The three state machines

### 1.1 Selection (canvas ↔ floating inspector share one source)

```
[none] --click node / click edge (target) / list row / dock title--> [selected id] (inspector opens)
[selected] --click another node / another edge--> [selected new id]  (local switch, zero network)
[selected] --click empty canvas / inspector ×--> [none] (an explicit clear stays cleared)
[selected] --promote succeeds--> [selected new permanent id]         (driven by the promote return)
[selected] --delete / trash succeeds--> [none]
```

- The auto-select gate: each box auto-selects its first card only while nothing was ever selected; an explicit clear (empty canvas / ×) is never overridden; an owner switch resets the gate.

- Selection loads the editor draft (`applyNoteSelection`); a dirty draft is never overwritten by the poll (the existing guard).
- Selection is purely local: any selection switch on the canvas issues **zero network requests** (acceptance item 5).

### 1.2 Viewport

```
[initial] --layout+size ready--> [fit] (once per fitKey = owner)
[fit] --wheel (cursor-anchored)--> [zoom 0.25–2.0]
[fit/zoom] --pointer down → move ≥4px--> [pan] --release--> [previous]
[any] --toolbar +/− --> [center-anchored zoom ×1.25 / ×0.8]
[any] --toolbar "fit" --> [fit]
```

- The click/pan boundary: within 4px it is a plain click (reaching the real target — node buttons, edge hit lines); only past the threshold is the pointer captured for panning — so native clicks are never swallowed by pointer capture.

### 1.3 Edge hover

```
[none] --pointer enters hit line (12px transparent)--> [hovering edge i]
[hovering i] --endpoints lit / neighborhood kept, rest dimmed --> --pointer leaves--> [none]
[hovering i] --click--> [select targetId] (follow the edge)
```

## 2. Anatomy

### 2.1 Card node (176×84px; the zoning geometry belongs to canvas-layout)

```
┌──────────────────────────┐
│ [fleeting|perm|project] ⟲3 │  kind chip + inbound badge (only >0)
│ Title (one line, clamped)  │
│ Excerpt (two lines)        │  omitted when empty
│ 2d left / overdue 1d       │  fleeting cards only; overdue in red
└──────────────────────────┘
```

- Selected: accent border + ring; hover: accent border; dimmed (outside a hover neighborhood): opacity .3.
- Project cards carry a 3px success-color left bar; fleeting cards a slightly accent tint; overdue: dashed border + faded.

### 2.2 Edges

- Ink line 1.5px (accent mixed into the border color); hover hit line 12px transparent.
- While hovering: the touched edge stays, unrelated edges opacity .18 / nodes .3.

### 2.3 Zoning (canvas-layout's domain geometry)

```
            ┌─ hub ring (inbound > 0, innermost)
 graph zone ├─ outflow ring (outbound only)
            └─ island ring (no links at all, outermost — the audit's reveal band)
────────────────────────────────
 intake strip (4-col grid): overdue first (from top-left), then fresh  ← fleeting never joins the graph, hence the zone
```

## 3. The density ladder (D6)

| Cards | Form |
|---|---|
| ≤30 | full detail (title + two-line excerpt + badges) — the real 13-card box sits here today |
| 31–150 | unchanged this round (the layout already expands by arc length); zoom-driven LOD stays P1 |
| >150 | drawable this round (the 200-card synthetic passes, bounds 5258×6758); the coarse mode stays P1 |

## 4. Theme token mapping (canvas.css rides only the --nb-* aliases → the host's --dsw-alias-*)

| Canvas element | token |
|---|---|
| Canvas ground / card surface | `--nb-surface` (bg-layer-1) |
| Edge ink | `--nb-accent` 55% mixed with `--nb-border` |
| Kind chip / toolbar ground | `--nb-sunken` |
| Overdue text / trash / dock frame | the `--nb-danger` family |
| Promote button | the `--nb-accent` family (is-accent) |
| Project bar | `--nb-success` |

Zero hardcoded colors across themes; the contrast check lands in the real-machine report (WCAG non-text ≥3:1).

## 5. The spike report (2026-11-03, completed before implementation)

- **Real data**: the stable node's `deepseek\.dsh/storages/notebook.json`, owner=standard: 13 cards (2 fleeting, 11 permanent — legacy no-kind rows default to permanent per the storage schema, 0 project), 8 cached links, both fleeting cards already overdue.
- **S1 determinism**: two identical runs + a shuffled run → placed arrays byte-identical. PASS
- **S2 zoning**: fleeting minFleetY=559 > maxGraphY=213.5 (strictly separated); hubs r=163 < outflow r=295 < islands r=427. PASS
- **S3 completeness**: all 13 cards placed exactly once. PASS
- **S5 scale**: the 200-card synthetic layout completes (5258×6758). PASS
- **fps measurement deferred**: an unfocused IAB tab composites no frames at all (0 rAF in 2s), so no honest local number exists — per the task book's discipline the number must come from the machine; measurement deferred to the real-machine acceptance (the same stack on the 3080 panel), recorded in the acceptance report.
- **Spike verdict**: the layout passes; canvas implementation starts; no force-directed library needed (D4 holds).

## 6. The expiry semantics (D3's landing)

- Window: `freshness.fleetingWindowDays` (default 2, clamped to [1,365]); visibility only, never a deletion.
- `expiresAt = updatedAt + window`, derived at read; the node, the list row, and the dock render from the same source.
- Exits: **promote** (one click from the dock or the editor, full write-time discipline) | **trash** (two-click confirm in the dock, behind the card-referenced guard) | **edit** (saving refreshes updatedAt — freshness renews naturally).
- No snooze, no timer, no auto-deletion (doctrine: docs/notebook-note-types.cn.md §2).
