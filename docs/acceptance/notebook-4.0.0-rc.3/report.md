# notebook 4.0.0-rc.3 canvas acceptance report (stable node 3080)

> Run: 2026-11-03 11:20–11:42 Asia/Shanghai. Node: `deepseek\.dsh` web profile, port 3080, explicit `DSH_HOME`.
> Build: four `4.0.0-rc.3` local tarballs; the 3080 acceptance build's `@veren/notebook-ui` `lib/client.js` is **449268 B** (Konva 10 scene graph, 0.85 opening view, empty-box guide, quadratic edges, foldable dock, owner election/memory). The final commit `51dc395` (adding card selection / connected components) builds to **452828 B** and was smoke-tested by a cold start on 3082 (same `DSH_HOME`, see §1).
> Evidence: `evidence/*.png` are real-host Chrome headless screenshots; readings were collected by CDP on the same page.
> Base change: the user ruled “Konva as the base” on 2026-11-03 11:23, superseding the task book's “do not split canvas.tsx” boundary. `canvas.tsx` is now a 103-line assembly layer; rendering lives in `canvas-stage` / `canvas-scene` / `canvas-card` / `canvas-theme` / `canvas-viewport*`.

## 0. Verdicts

| # | Item | Verdict | Evidence |
|---|---|---|---|
| 1 | O1 owner election | **pass** | A fresh browser profile (`lastOwner=null`) opened on `standard` with 9 cards; declared-but-empty `cordis` no longer steals the first screen |
| 2 | O5 owner memory | **pass** | Selecting `cordis` wrote `notebook-last-owner=cordis`; a full reload kept `cordis` |
| 3 | O2 new-note loop | **pass** | Canvas “New note” → list editor (“New note” heading) → title/body → Save → automatic return to canvas, count `笔记 1`; screenshots 03/04 |
| 4 | O3 empty canvas | **pass** | Empty `cordis` box renders `.notebook-canvas-empty` with the list's copy and a create action; screenshot 02 |
| 5 | O4 readable opening zoom | **pass** | `data-canvas-zoom=0.85`; title 13px × 0.85 = **11.05px**; explicit Fit still works (0.931 here, all 9 cards visible); screenshots 01/06 |
| 6 | O6 curved edges and hit face | **pass** | 8 quadratic Bézier edges; hovering a computed edge midpoint lit both endpoints and dimmed the rest; the 12px hit stroke uses the same `Path`; screenshot 05 |
| 7 | O7 dock fold | **pass (component preview + unit tests)** | `tests/dock.spec.ts` covers ≤3 full list, ≥4 folded count line, expand restores rows; the real host had 0 overdue cards, so a preview of the same `CanvasDock` component and CSS with 5 synthetic overdue cards shows the folded one-line count + Expand and the expanded 5 rows + Collapse; screenshots 08/09 |
| 8 | Regression | **pass for the accepted build** | four packages, 166 tests green (notebook 63 / app 19 / ui 78 / bundle 6); typecheck clean in all four; the panel mounted on 3080 and did not reproduce the old entry-abdication split curse |

## 1. Real-host readings

```json
{"owner":"standard","lastOwner":null,"zoom":"0.85","count":"笔记 9","stage":{"w":1078,"h":736},"canvases":1}
{"owner":"cordis","lastOwner":"cordis","count":"笔记 0","empty":true,
 "emptyText":"这本记事本还是空的。\n切到列表，写下第一条——画布只负责看关系。\n新建笔记"}
{"canvasMode":true,"listMode":false,"canvasCount":"笔记 1","dirty":false}
{"zoom":"0.9313261163734776","titlePx":"12.11"}
```

Final-tree snapshot (3082 cold start, same `DSH_HOME`):

```json
{"port":"3082","owner":"standard","zoom":"0.85","count":"笔记 9","canvases":1,"empty":false,"lastOwner":null}
```

## 2. Evidence

| File | Content |
|---|---|
| `evidence/01-default-standard.png` | First open: owner=standard, 9 cards, zoom 0.85, 8 curved edges |
| `evidence/02-empty-cordis.png` | Empty cordis box with the centre guide card |
| `evidence/03-authoring-list.png` | New note from canvas lands in the list editor |
| `evidence/04-saved-canvas.png` | Save returns to canvas; `笔记 1`, new card present |
| `evidence/05-edge-hover.png` | Edge hover: endpoints lit, rest dimmed |
| `evidence/06-fit-all.png` | Explicit Fit brings all 9 cards into the viewport |
| `evidence/07-final-build-3082.png` | Final-tree snapshot cold-started on 3082: same standard/9 cards/0.85, panel mounted |
| `evidence/08-dock-fold-preview.png` | O7 component preview: 3 cards keep the full list; 5 cards fold to one "Intake 5 + Expand" line |
| `evidence/09-dock-expanded-preview.png` | O7 after Expand: 5 rows + Collapse |

## 3. Assembly notes

- Tarballs: `%TEMP%\notebook-rc3`, then `pack-local.mjs` → `repack.mjs`.
- The profile was installed with **pnpm 11.28.5** (its store is `.pnpm-store/v11`); the repository's pnpm 10 refuses that store with `ERR_PNPM_UNEXPECTED_STORE`.
- `repack.mjs` now probes whether the local `tar` accepts `--force-local`; System32's bsdtar rejects it and used to abort repacking.
- The only startup warning is the pre-existing `dsh-workbuddy-oauth` bundle skip.

## 4. Gaps

- **O7 visual**: no real box has more than three overdue cards. To avoid mutating the real store, the visual check used a standalone preview of the same `CanvasDock` component and the same `panel.css`/`canvas.css` with 5 synthetic overdue cards (screenshots 08/09); the fold rule also has 4 pure unit tests. The >3 form has not been triggered on real host data.
- **Concurrent work**: this build was installed at 11:25; between 11:36 and 11:51 another session added card selection / connected-component highlighting on the Konva base, now committed as `51dc395`. All four package gates pass on that commit, and its build (452828 B) passed the 3082 cold-start smoke. The 3080 build (449268 B) predates that feature, so the O1–O7 evidence is unaffected.
- **Split curse**: this multi-file Konva split mounted correctly on 3080, so the `ac7df98` finding did not reproduce here; keep the note for a later retest.
- Host detail-page zero-tool defect D remains out of scope.

## 5. Gates

| Item | Result |
|---|---|
| notebook unit tests | 63/63 pass |
| notebook-app unit tests | 19/19 pass |
| notebook-ui unit tests | 78/78 pass (9 specs, including 4 new dock-fold cases) |
| notebook-bundle unit tests | 6/6 pass |
| Four-package typecheck | no `src/` diagnostics |
| `pnpm check:docs` | pass (178 docs, 21 declarations) |
| `pnpm check:src-artifacts` | pass |
| `pnpm check:function-length` | only 62 overlong functions in `plugins/dsh-superagent` (concurrent work, unrelated) |
| `pnpm check:entries` | only `plugins/dsh-superagent`'s missing `lib/index.d.ts` (concurrent work; needs its build) |
