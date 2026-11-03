# Notebook Canvas Optimization Plan: Deepened Task Book

> Status: **deepened, awaiting execution**. Origin: 2026-11-03 user verdict "too many unreasonable things".
> Predecessors: docs/notebook-canvas-expiry-task.md (canvas build) + docs/notebook-canvas-interaction.md (four rulings) + docs/acceptance/notebook-4.0.0-rc.2/report.md.
> Discipline: every item carries forensics (file:line or screenshot readings); execution on the stable node 3080; versions fold into the unfinalized 4.0.0-rc.2.

## §0 The forensics-backed "unreasonable" list (P0 = functional dead-end, P1 = professional feel, P2 = polish)

| # | Symptom | Forensics | Level |
|---|---|---|---|
| U1 | Opening the panel lands on an **empty box** (cordis); the real box (standard, 9 cards) needs a manual re-select — a new user's first look is a blank canvas | source.ts:122 `owners.find(declared)?.id` — declared-first, ignores card count/activity | P0 |
| U2 | In canvas mode **"New note" is a dead end**: startNew sets editingNew, but the canvas has no editing face — the draft is invisible and unwritable | panel.tsx:214 onStartNew → view.startNew; CanvasColumn carries no editor | P0 |
| U3 | **Empty box = blank canvas**, zero guidance (the list has empty-state copy; the canvas has none) | canvas.tsx has no noNotes/EmptyNotes reference | P1 |
| U4 | **Fit = cram**: fit squeezes all 9 cards into the viewport (scale ≈ 0.5), the 12px card title becomes ~6px — the thing you most need to read on open is unreadable | user screenshot (image-40c2a4) + DOM-measured post-fit transform scale | P1 |
| U5 | **Straight edges cross into X-bundles** (long diagonals such as rc6-sales ↔ pricing-strategy cross each other); relation flow is unreadable | user screenshot (image-33eb8c), multiple crossings visible | P2 |
| U6 | Owner choice is **not remembered**: every open falls back to the default and the person re-selects | source.ts has no persistence | P1 |
| U7 | The intake dock **permanently reserves the bottom** and squeezes the canvas even at one overdue item | canvas.css .notebook-dock flex 0 0 auto | P2 |
| U8 | (Host legacy) detail-page zero tools, polluted updatedAt — **not this swim lane**; booked, not expanded | docs/acceptance rc.2 report §4 | booked |

## §1 The four questions

### 1. What a top professional would do that we are not asking for
- A **heuristic evaluation**: run the whole panel against Nielsen's ten plus canvas-genre heuristics (the accepted baselines from Miro / Heptabase / Obsidian canvas), scoring each finding 0–4 severity — "unreasonable" stops being drive-by rulings and becomes a severity ledger.
- **Task-timing baselines**: measure clicks and seconds for the three core tasks (find the hub card / process one intake item / explain how two cards relate) before and after — "more reasonable" is adjudicated by task-surface numbers, not vibes.
- **First-run and empty-state design**: the first 7 seconds on open decide everything (owner, empty state, guidance); professional products spec it separately.
- **Readability ladder first**: define what is visible at which zoom before touching fit behavior.

### 2. The rawest material
- This session's first-hand traces: four real-machine screenshots (fit-cram, X-crossings, the inspector era), DOM probe readings (scale, userSelect, node rects), the storage JSON (real 13 → 9 card states), the parallel session transcript (the agent's wall: detail-page zero tools).
- Two shell mechanisms in source: scoped-slots.tsx entry abdication (the error-swallowing machinery) + source.ts owner election — **read both before changing behavior**.
- External primaries: Obsidian canvas / Heptabase empty-state copy and open-zoom behavior (open them and note 20 observations; do not read comparison posts).

### 3. Methods and tools
- Every fix hangs on an **invariant or state machine** (U1 = election invariant, U2 = new-note flow state machine, U4 = zoom policy function); no ad-hoc patches.
- Canvas behavior lands as **pure functions + property tests** (zoom policy, election function unit-testable); UI changes go through real-machine smoke (mind the split curse: no more file splits inside canvas).
- RITE-style small-step usability passes (each fix gets 1–2 task scripts walked on the machine).

### 4. External adjudicators
- U1/U2/U3: on a cleared first open, "sees my own cards within 7 seconds" is decidable (a screen recording is the evidence).
- U4: at the default open state, card titles ≥11px readable without interaction — screenshot plus computed-style reading.
- U2: a recording of the full flow (click new → list editor opens → save → back on canvas the new node appears).
- Regression: lane gates + all 91 tests green; the 3080 install verification as usual.

## §2 Rulings (the O series)

- **O1 (P0) Owner election rewrite**: `chooseOwner` becomes "boxes with cards first (by cards × recency descending), declared empty boxes last"; the choice persists to localStorage (per-browser lastOwner), an explicit switch overrides it. Election lands as the pure function `electOwner(owners, lastOwner)` + unit tests.
- **O2 (P0) New-note flow reconnected**: in canvas mode "New note" auto-switches to list mode and opens the editor (list = authoring face, canvas = relation face — consistent with the "no editing on canvas" ruling); after save, switch back to canvas where the new node is visible. State machine: idle → authoring(list) → saved(canvas).
- **O3 (P1) Canvas empty state**: nodes = 0 renders an empty-state card in the canvas center (reusing the list's noNotes copy plus a "switch to list to create" pointer); pure presentation.
- **O4 (P1) Readability-first default zoom**: open/owner-switch no longer fits; default zoom = 0.85 centered on the hub ring's centroid; "fit" stays as an explicit button. The zoom policy lands as the pure function `initialView(layout)` + unit tests; the LOD table (0.85 full detail) goes into the interaction spec.
- **O5 (P1) Owner memory**: the O1 localStorage persistence (lastOwner); the election only fires with no memory and multiple boxes.
- **O6 (P2) Curved edges**: straight edges become quadratic béziers (control points offset by ring direction), hit lines follow; pure rendering + screenshot adjudication.
- **O7 (P2) Dock collapse**: at ≤3 overdue the dock keeps its form; beyond that it collapses to one count row with an expand button. Screenshot adjudication.
- **Boundaries**: no touching the host detail-page zero tools (defect D, page-registry lane); no in-canvas editing (user ruling); no file splits inside canvas.tsx (the split curse is on file).

## §3 Acceptance (each as "what to look at / pass bar")
1. O1/O5: cleared first open lands on the box with the most cards; switching boxes and refreshing keeps the choice. Recording + DOM readings.
2. O2: canvas "new note" → list editor opens → save → back on canvas with the new node. Recording.
3. O3: a fresh empty box shows the empty-state card in the canvas center. Screenshot.
4. O4: at the default state card titles are ≥11px readable; the fit button still brings the whole graph in. Screenshot + computed style.
5. O6: no straight edge crosses over a node; hover hit-testing unregressed. Screenshot.
6. Regression: four-package typecheck + tests green; canvas.tsx line count unchanged (no splits); 3080 smoke passes.

## §4 Execution order
O1+O5 (election + memory) → O2 (new-note flow) → O4 (default zoom) → O3 (empty state) → O6+O7 (polish). Each step adjudicated on the machine before the next.
