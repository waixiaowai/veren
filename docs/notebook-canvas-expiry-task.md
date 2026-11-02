# Notebook Canvas + Fleeting Freshness Window: Deepened Task Book

> Status: **Deepened; two decision points await the user (end of §3) — defaults apply if unset.**
> Origin: 2026-11-03 user brief — "fleeting notes get an expiry time; the whole interface becomes a connected card-knowledge canvas; pick a fitting tech stack; use a professional UI/product designer's perspective."
> Family version line: all four packages `4.0.0-rc.1 → 4.0.0-rc.2` (MAJOR rc line unfinalized; new capability folds in; caller breakage list: none).
> Discipline: all host-level verification runs on the stable node `deepseek\.dsh` (explicit DSH_HOME on every command); spike before implementation; bump before publish (registry is immutable).

---

## §0 Scope ruling (read first — prevents building the wrong face)

1. **The canvas lives in the `notebook-ui` panel** (the screenshot this task is based on is that panel's React face: owner selector + list + editor). `notebook-app` prompt pages stay untouched: PAGE blocks are one-shot static text — a canvas cannot live there; and their first screen already carries the intake queue / to-process zone / riddles (`pages.tsx` instructions). The model face has zero gaps.
2. **"Expiry time" introduces no timer and deletes no rows.** The doctrine is already on file (docs/notebook-note-types.cn.md §2): "trash is an explicit action — no TTL, no timer. Expiry only changes visibility (intake-queue pinning), never auto-deletes rows." This task promotes that **already-adjudicated but human-invisible** mechanism — the panel snapshot carries no stats at all; the freshness window exists only in the `stale` tool and `box_stats` — into a surface that is **human-visible, configurable, and processable in place**. If hard deletion is truly wanted, see §3 decision point ①.

## §1 Forensics on file (read before executing; file:line as of current master)

### Data plane (plugins/notebook/src)
- `types.ts:71` `NoteKind = fleeting | permanent | project`; `types.ts:74` `NoteRecord` (owner = preset, kind, anchor) — **no expiry field of any kind**.
- `queue.ts:25` `FLEETING_DAYS = 2` (freshness window; Ahrens's "a day or two" taken at two); `queue.ts:40` `intakeView → { fleet, overdue }`; `queue.ts:50` `isOverdue` — **derived at read time, not a schema** (the module header says it plainly: "a query, never a schema"; "the window never deletes").
- `graph.ts:281` `STALE_DAYS = 7` (lost-card window for permanent/project: no inbound links and past the window). Link cache rows = owner/sourceId/targetTitle (`graph.ts:35`); occurrences whose target has no card never surface as edges (legacy v1 bodies).
- Data all present, panel wired to none of it: `types.ts:206` `BoxIntakeView`, `types.ts:236` `BoxStatsView` (density/intake/rates), `types.ts:177` `RiddleView` (pairs sharing neighbors without linking).
- `types.ts:249` `NotebookConfig = { globalTools }`; `index.ts:72` Config schema (schemastery) — the landing spot for a freshness field already exists.

### Tool face
- capture / promote / archive / stale / riddles / stats / hubs / find / cardLinks / backlinks all present (`types.ts:258` ff.); `capture_note` with an anchor lands as a project card (2f47456).
- **The model face has zero gaps**: expiry is already visible to the AI (`stale`, `box_stats.intake`, first-screen instructions). This task adds zero tools and changes zero tool descriptions.

### Client face (plugins/notebook-ui/src/client, 1742 lines total)
- `remote.ts:65` `NotebookSnapshot = { owners, owner, notes, linkCounts, status… }` — **no stats / intake / riddles**; nine Remote endpoints — **no whole-box edge list** (`cardLinks` is one card's two directions; the canvas needs the whole graph in one read).
- `panel.tsx:71` two-column layout (list left + editor right); `panel.tsx:106` `onOpenCard` already wired (rc3 task one, already implemented); **`use-notebook-view.ts` is at 303 lines — over the 300 hard cap** — touching it obliges splitting it.
- `remote.ts` schemas are all loose (module note: additive Host fields never break the client) — additions are safe.

### In-repo canvas precedent (packages/graph/, this repo's source, not vendor)
- `flow-canvas-panel` (`@deepseek-ai/dsh-graph-flow-canvas-panel` 0.1.13, private): a **zero-canvas-dependency** hand-rolled SVG canvas — `GraphEdges.tsx` (SVG edge layer), `useCanvasViewport.ts` / `viewportAuto.ts` (viewport control), `layout.ts` (layout), `view-state.ts` / `store.ts` (view state vs. host data facets), `DefaultNodeCard.tsx` + `slots.ts` (per-node-type renderer slot); multi-theme, multi-locale, and every file within the 300-line cap, all verified.
- That precedent passed **eight review rounds** (docs/graph-canvas-review{,-round2,-round3}, graph-canvas-ui-review, graph-canvas-panel-review{,-round2}, graph-acceptance-review{,-round2,-round3}) — every pit from data plane to real-host GUI is on file; it is this task's method blueprint.

### Real-data baselines (for adjudication)
- Stable-node 11-card audit (2026-11-02): 64% acceptance residue, true-card density 0.25, the only qualifying card is an island, legacy no-kind rows lack a transition path.
- Three-lane survey (40+ pages of forensics): card common denominator = address + own-words body + reference line; community reference 2.6 links/card.
- Current real machine state: 13 cards (screenshot) with fleeting/permanent/project, islands, and residue — the spike's and acceptance's input.

## §2 The four questions

### 1. What a top professional would do that the brief does not ask for

- **Adjudicate the product archetype before any library talk**: "canvas" has two species — the Obsidian-style force-directed atlas (positions are computed; a navigation surface) and the Heptabase/Scapple-style spatial workspace (positions are content; must persist). That cut decides the data model and half the workload; it comes first (→ D1), not "which library".
- **Interaction spec before adjectives**: three state machines (selection / viewport / edge hover) + card anatomy + a density ladder (what the 13/50/200/1000-card form looks like). "Smooth" and "beautiful" are not acceptable acceptance criteria; state machines are.
- **Single-authoring-surface discipline**: the canvas is the navigation/relation surface; the editor remains the only text-authoring surface. The classic death of products in this genre is growing two half-editors.
- **Expiry is a process, not a timer**: at the deadline the processing actions (promote / trash) must be at hand — the product value of expiry is forcing processing, not deleting data.
- **An a11y escape path**: canvas UIs are accessibility dead-ends. The list stays as the accessible equivalent; the canvas must not hide any information the list lacks.
- **A plan for the scale cliff**: 11 cards draw nicely — what about 500? LOD and performance budgets are written as numbers before code.
- **Legacy data renders with zero hand-holding**: the 13 existing cards (including no-kind v1 rows, islands, residue) must present correctly as-is — they are the real user's first look at the canvas.

### 2. The rawest material (not what others have pre-digested)

- **Two in-repo sources**: the notebook four-package sources in full (§1 list); flow-canvas-panel's client sources (working implementations of viewport/edges/layout/view-state, eight review rounds on file).
- **Three already-adjudicated documents**: notebook-note-types.cn.md (the disposal semantics, the two-window semantics), notebook-zettelkasten-design.cn.md (design axioms), notebook-rc3-tasks.cn.md (task-book and implementation precedent).
- **Three real-data sets**: the 11-card audit, the three-lane survey, the current 13-card machine state.
- **External primaries**: the Obsidian graph plugin's actual interaction set (wheel semantics, hover neighborhood highlight, filters), Heptabase/Scapple's spatial model (as contrast, not target), Ahrens's fleeting-notes chapter.
- Deliberately not raw material: "canvas library comparison posts" — library choice is one matrix inside D4; the precedent and the data plane are first.

### 3. Methods and tools

- **Weighted matrix + spike-first**: candidates pass a weighted matrix (React fit / theme reach / a11y / splittable within the 300-line cap / size / maintenance); the winner renders a spike from the real 13 cards — **implementation does not start until the spike passes**.
- **Interaction spec as state machines + ASCII wireframes + anatomy diagrams**, submitted with the PR.
- **Additive-only data-plane diff**: a whole-box graph read endpoint (nodes/edges/riddles/stats in one read) + snapshot gains stats + the freshness config; loose-schema compatible, zero breakage.
- **Derived-pure-function discipline**: layout ≡ f(snapshot); same input, same layout (deterministic, property-testable); view state (viewport/selection/filter) and card data stay in separate facets, per client-ui-slots iron rules 8–12.
- **Measured performance budgets**: Chrome profiler, ≥50fps pan/zoom at 200 synthetic cards, bundle-delta accounting — numbers go into the acceptance report.
- **Acceptance matrix**: dual-theme screenshots, the blind three-question test, find-a-card timing against the list baseline, measured WCAG non-text contrast, pnpm check, composition tests, added items in the 3080 real-machine checklist, the rc.2 release chain.
- **Two-week residue-rate re-measure**: the final adjudicator of the expiry mechanism (against the 64% baseline).

### 4. External adjudicators (beyond you and me)

- **Real stable-node data renders with zero hand-holding**: the 13 cards incl. islands and residue, verified once at spike and once on the machine.
- **The blind three-question test**: someone who has never seen the panel answers from the canvas alone — which card is the hub? which fleeting cards need processing? how are these two named cards connected?
- **Numbers**: fps, bundle, contrast — measured values in the report, never "should be fine".
- **Community comparison**: the same find-a-card / link-a-card tasks on the same data in Obsidian's graph, timed — not to win, to be in the same league.
- **Residue rate**: two weeks after release, the share of overdue fleeting cards actually processed (promote+trash) vs. the 64% baseline.
- **Gates**: pnpm check green, registry contributions carry dispose/HMR tests, version bumped first, 3080 install verification per AGENTS.md (bundles list + hardlink check).

## §3 Rulings (the D series)

### D1 Product archetype = card-shaped-node atlas; positions are not persisted
- Nodes are mini-cards (kind chip + title + two-line excerpt + inbound count + aging state); positions derive from a deterministic layout (≡ f(snapshot)); **no persisted coordinates, no manual arrangement**.
- Rejected: the spatial workspace (position persistence = a new storage domain + data versioning + migration, contradicting the derived-pure-function discipline — revisit only on real demand); the Obsidian-style dot atlas (cards unreadable; fails the "card knowledge canvas" brief).

### D2 IA: canvas = default face, list demoted to index face, editor = the only authoring face
- Two panel modes: **canvas (default) | list (index + accessible equivalent)**, plus the editor seat for the selected card (existing editor component reused).
- Narrow viewport (<720px) falls back to today's two-column layout; the canvas toggle hides.
- Domain fact baked into design: **fleeting cards are off-graph** (links may dangle; they never enter the links cache) — the canvas naturally congregates fleeting cards into a distinct "intake zone" and reveals islands at the rim. That is a feature, not a defect; the zoned layout builds on it.

### D3 Expiry semantics: configurable window, derived deadline, in-place processing
- `NotebookConfig` gains `freshness: { fleetingWindowDays }` (default 2, clamped ≥1; defined via schemastery per the AGENTS.md hard rule).
- `expiresAt` is **derived at read time** (updatedAt + window) — zero schema change, same discipline as queue.ts's "a query, never a schema"; a per-card TTL field is deferred.
- State machine: **fresh (age < window) → overdue (age ≥ window) → exits = promote | trash | edit (editing refreshes: updatedAt moves naturally)**. No new ledger action (promoted/trashed already recorded); no snooze (editing refreshes — subtraction).
- Three panel landings: list-row aging state (two states + time remaining), canvas-node aging state (overdue fades; intake zone gathers them), and the **intake dock** (overdue queue pinned on top + one-click promote/trash — the shortest path of the processing ritual).
- Rejected: auto-deletion (§0.2 doctrine; data destruction is irreversible and terminal actions must have an owner); merging FLEETING_DAYS with STALE_DAYS (one is the intake window, one the lost-card window — note-types already ruled them separate).

### D4 Tech stack = replicate the in-repo precedent; no canvas library
- **Rendering: React + tsx + css modules + an SVG edge layer**; viewport/edges/node slot/view state replicate flow-canvas-panel's implementation patterns into notebook-ui (copy-and-adapt, with a header note crediting the source; no shared-package extraction — extract a `canvas-kit` only when a second canvas appears, per the three-example rule).
- **Layout: deterministic zoning** (fleeting congregated in the intake zone; permanent/project arranged by connectivity toward the center; islands on the rim) — a pure function, property-testable; **no force direction** (non-deterministic, jumps on reload, expensive to test).
- If the spike proves force layout necessary: the only permitted dependency is `d3-force` (algorithm only, no rendering bundle) under the hand-drawn layer.
- Why the `@xyflow/react` comparison case loses: bundle weight (hundreds of KB into a host panel), deep node customization sooner or later hits the library's abstraction wall, and the repo already holds a precedent that passed eight review rounds. "Don't reinvent the wheel" inverts here: **the wheel is already in the repo — copying it is not reinventing**.
- File budget: every new canvas source file stays within 300 lines (precedent on file); splitting `use-notebook-view.ts` (303 lines, already over) folds into this task.

### D5 Data plane = the whole graph in one read (additive)
- New Remote endpoint `graph`: `{ owner } → { nodes, edges: { sourceId, targetId, targetTitle }[], riddles, stats }` — the host side resolves it by joining the links cache with notes (dangling targets never surface, same read semantics as `graph.ts`); `remote.ts` gains loose-schema fields.
- The snapshot gains stats — list aging rendering reuses the same read; no second opening.

### D6 Density ladder (goes into the interaction spec)
- ≤30 cards: full detail (title + two-line excerpt + badges); 31–150: zoom-driven LOD (excerpts hidden when far, edge labels off); >150: coarse mode (kind color blocks + hub names) with a "use the list to find cards" pointer.
- Performance budget: ≥50fps pan/zoom at 200 synthetic cards (measured on integrated graphics, into the report).

### Decision points (user rules; defaults apply if unset)
1. **Hard deletion of fleeting cards**: **recommended no** (doctrine on file; expiry = visibility + processing). If insisted: only acceptable as a default-off switch ("auto-trash N days after expiry + ledger row"), and as data-destruction semantics it must be a separate project through its own rc — it does not fold into this task.
2. **Keeping the list face**: **recommended to keep as index/accessible face** (canvas is the default). If the canvas must fully replace the list, the a11y and narrow-viewport fallback plan comes first, before any code.

## §4 Deliverables and increments

### P0 (one rc.2)
1. **Spike report**: the real 13 cards, zoned-layout screenshots, measured fps, the matrix scorecard — no implementation until it passes.
2. **Interaction spec** (docs/, bilingual): three state machines + card/edge anatomy + density ladder + theme token mapping.
3. **Data plane**: the `graph` endpoint + snapshot.stats + freshness config; tests: resolution join, dangling exclusion, owner isolation, config clamping.
4. **Freshness made visible**: list-row aging states + the intake dock (in-place promote/trash) + the config face.
5. **Canvas skeleton**: viewport / edge layer / card nodes / deterministic zoning / canvas-list toggle / narrow-viewport fallback.
6. **Tests**: layout pure-function property tests (same input same layout, zoning invariants), dispose/HMR safety, composition (real Loader).
7. **Acceptance report + rc.2 release chain** (bump all four packages first; registry immutable).

### P1 (a separate task book after P0 acceptance — not this task)
- Riddle candidate edges (dashed; click = highlight both cards + a one-click draft cross-link), hub-weight rendering (inbound count → border/type-size gradient), canvas filters (kind / island spotlight).

## §5 Acceptance (external adjudication — every item as "what to look at / pass bar")

1. **Real data renders**: open the panel on 3080, switch to canvas — the 13 cards (incl. no-kind legacy, islands, residue) all present, zero hand-holding, console clean. Pass = all present, no errors.
2. **Blind three questions**: a person who never saw the panel answers from the canvas: which is the hub? which fleeting cards need processing? how are "rc1 acceptance outer-link card" and "rc1 acceptance re-write evidence" connected? Pass = all three right.
3. **Aging states**: move one fresh fleeting card's updatedAt past the window — list row and canvas node both turn overdue, the intake dock gathers it. Pass = both faces agree, dock pins it.
4. **Processing loop**: promote one fleeting card from the dock — its node migrates into the graph and its resolved edges appear; trash one — the node disappears and the ledger records trashed. Pass = loop closes, books match facts.
5. **Edge interaction**: hover an edge = neighborhood highlighted, the rest fade; click an edge = target card selected, editor follows. Pass = interaction works with **zero new network requests** (selection is local).
6. **Themes and contrast**: the full-theme screenshot matrix; measured edge/text contrast. Pass = WCAG AA (non-text ≥3:1).
7. **Performance**: profiler at 200 synthetic cards. Pass = pan/zoom ≥50fps, bundle delta accounted in the report.
8. **a11y**: the full processing flow by keyboard alone (switch to list → find card → promote). Pass = reachable throughout; the canvas holds no information the list lacks.
9. **Gates**: pnpm check, composition, and package specs all green; the four packages bumped and signed at rc.2.
10. **Two-week residue rate** (post-release follow-up): processed share of overdue fleeting cards vs. the 64% baseline, appended to the acceptance report.

## §6 Boundaries (what this task does not do)

- No position persistence / manual arrangement / multiple canvases / collaboration cursors (the spatial workspace is deferred whole).
- No in-canvas text editing (the editor is the only authoring surface).
- No touching the links store or the `[[…]]` grammar (the canvas is a derived read face).
- No full-text search (design axiom D10 already rejected it).
- No canvas on the `notebook-app` prompt pages (text form; the model face has no gaps).
- All host-level verification on the stable node `deepseek\.dsh`; explicit DSH_HOME on every command; never touch `~/.dsh`.
