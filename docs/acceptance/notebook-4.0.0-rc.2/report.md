# notebook 4.0.0-rc.2 canvas acceptance report (stable node 3080)

> Accepted: late 2026-11-03. Node: `deepseek\.dsh` web profile, port 3080 (explicit DSH_HOME).
> Build: notebook-ui client 105525B (full-bleed canvas + edge-click selection + the everSelected close gate); four rc.2 packages installed from local tarballs via repack.
> Screenshots live in the ZCode session artifacts; every number is quoted inline.

## 0. Verdict summary

| # | Item | Verdict | Evidence |
|---|---|---|---|
| 1 | Real data renders, zero hand-holding | **pass** | the standard box rendered live across three states (13 → 11 → 9 cards, legacy no-kind rows defaulted to permanent), no manual fixes, no error banner |
| 2 | All-canvas face + visible edges + no blank margins (three user rulings) | **pass** | the permanent editor column is gone (floating inspector top-left); 8 edges visible after the explicit-SVG-viewport fix; the 1120px width caps removed — full bleed |
| 3 | Aging visibility + intake dock | **pass** (historical frames) | earlier frames: 2 overdue fleeting cards pinned in the dock, red "已过期 2 天" chips, list-row aging states; the box was processed in parallel afterwards and the dock correctly disappeared |
| 4 | Processing loop (trash) | **pass** (production-grade evidence) | 5 `trashed` ledger rows (both rc7 fleeting cards at 18:59Z + 3 residue cards at 19:11Z); dock, canvas and counters all followed |
| 5 | Edge interaction (follow-the-edge selection) | **pass** | clicking the first edge switched the inspector to its target card "2.0.3 验收" (title read back changed); hover-neighborhood dimming has historical-frame screenshots |
| 6 | Inspector close stability | **pass** | × stays closed across poll rounds (the everSelected gate); close/reopen/switch cycles all correct |
| 7 | List equivalent face | **pass** | list mode shows 9 rows + the editor column; the canvas/list toggle works |
| 8 | Measured fps | **blocked (environment)** | while the host window is occluded the page receives 0 rAF per second (measured) and ResizeObserver is frozen — no honest frame-dependent measurement is possible; deferred to a foregrounded session |
| 9 | Gates | **pass** | four packages typecheck + 91 tests green (notebook 63 / ui 22 / bundle 6); function-length clean in this lane; check:docs green; the check:plugins failure traces 100% to in-flight dsh-superagent lane changes (unrelated) |

## 1. The three user rulings and their landing

1. **"All canvas, no editor"** — canvas mode is full-bleed; the permanent editor column is removed; the selected card's editor + link sections became a floating inspector (× to close) over the canvas.
2. **"Node relations as nodes and edges"** — the invisible-edge root cause was an SVG 0×0 viewport clip; explicit width/height over the drawing plus a translate group made all 8 edges visible; ink widened to 1.8px.
3. **"No blank margins"** — the three 1120px width caps (header / layout / banner) removed; the panel spans full width.

## 2. Deployment recipe (distilled this round)

- Re-installing the same-version file: tarball is a pnpm no-op ("added 0") — **remove the member directories before adding**; the bump-before-publish convention exists for the registry form; local tarball iteration re-installs instead.
- Two repack.mjs fixes: family-prefix ambiguity (`veren-notebook-` also matches `-app`/`-ui`) → exact `name-version` match first; `pnpm pack` rewrites members' `workspace:^` into semver ranges that an unreleased rc cannot resolve → member tarballs' sibling deps are rewritten to file: as well.
- The 3080 zombie: the PID from a `netstat LISTENING` grep may not be the real listener (killed the wrong one repeatedly); cross-check every `:3080 ` state line, and after killing **poll until LISTENING/ESTABLISHED/FIN_WAIT are all gone** (~35s) before starting.
- With the IAB pane occluded: rAF=0, ResizeObserver frozen, pointer hit-testing dead — every frame-dependent interactive check is **untrustworthy** in that state; DOM click dispatch (el.click) still works and serves for wiring verification.

## 3. Defect and fix ledger

| Defect | Fix |
|---|---|
| × close bounced back by the auto-select-first follow effect | everSelected gate: auto-select once per box; an explicit clear stays cleared; reset on owner switch |
| Edge click dead (pointerdown captured immediately, retargeting the click to the stage) | capture only past the 4px threshold: within it a plain click reaches its real target; past it the gesture is ours; empty-canvas clicks moved to the stage's onClick |
| SVG 0×0 viewport + overflow reliance clipped on the real machine | explicit width/height covering the drawing + a translate group |

## 4. Data forensics note

- The parallel session (the card-list page's agent) processed the box per its own acceptance findings: both rc7 fleeting cards (18:59Z) and 3 residue cards (19:11Z) trashed, books balanced — the "intake only fills, never drains" lesion was genuinely digested.
- The earlier `updatedAt < createdAt` polluted timestamps (batch-rewritten) left with those cards; the aging mechanism derives from updatedAt, so if such dirty values ever reappear the symptom would be "fresh cards flagged overdue" — a data-hygiene issue, not a mechanism defect.

## 5. Leftovers

- The fps number: to be measured when the host window is foregrounded (same stack as the spike: 200 cards, transform viewport; the spike's static budget already passed).
- A live single-click promote: the box currently holds no fleeting cards — wait for the next natural one (the write path is covered by the trash loop's production evidence and 63 unit tests).
- Release chain: registry push + staging pin + market index, awaiting the user's go.
