# notebook 3.0.0-rc.1 Real-Machine Acceptance Report (stable node 3080)

> Date: 2026-11-02. Subject: `@veren/notebook(-app/-ui/-bundle) @3.0.0-rc.1` (registry artifacts).
> Node: `deepseek\.dsh` (explicit DSH_HOME, port 3080, web profile, pnpm 11).
> Verdict: **all eight checklist items pass** — including three real-machine defects found, root-caused, fixed, and re-verified on the spot; zero-migration medium evidence captured.
> Evidence: `docs/acceptance/notebook-3.0.0-rc.1/evidence/` (real-machine screenshots / medium snapshot).
> Chinese version: [acceptance-report.cn.md](./acceptance-report.cn.md).

## 1. Eight-step checklist

| # | Item | Result | Evidence |
|---|------|--------|----------|
| 1 | Upgrade path 2.2.1 → rc.1, old notes intact | ✅ | `01-upgrade-old-notes-visible.png`; pre-upgrade medium snapshot `notebook-v1-before-upgrade.json` |
| 2 | Write card linking an existing card → success | ✅ | `02-write-card-with-link-success.png` |
| 3 | Link to a missing title → refusal with suggestions | ✅ (after fix) | defect: `03-...-DEFECT-generic-error.png`; fixed: `03b-...-FIXED-structured-refusal.png` |
| 4 | Rename → referrer bodies rewritten, backlinks follow | ✅ | `04-rename-rewrites-referrer-body.png` |
| 5 | Delete a referenced card → refused, referrers named | ✅ | `05-delete-guard-names-referrer.png` |
| 6 | list_hubs / list_backlinks truthful | ✅ | `06a-list-hubs-truthful.png`, `06b-panel-backlink-badges.png`, link sections in 05 |
| 7 | Restart → cards and links intact | ✅ | `07-restart-data-intact.png` |
| 8 | Uninstall bundle → clean teardown | ✅ | zero leftovers, storage preserved (6 cards), reinstall delivers full first screen |

Medium evidence: `linksSyncedAt: null → 1`, `unit.version` stays 1 (zero migration), new empty `links` table.

## 2. Three real-machine defects (root-caused, fixed, re-verified)

- **A (severe, user-visible): panel "selected ↔ none" infinite flapping.** `useOwnerChangeReset` keyed its effect on a per-render closure → reset after every render → ping-pong with the follow effect. Fix: closure via `useRef`, effect keys on `owner` only.
- **B (severe): cardLinks fetch storm exhausted the browser.** `NoteLinks`'s effect depended on the `fetchLinks` callback identity (fresh each render) → refetch per render, compounded by A (114k+ failed requests). Fix: callback via ref, effect keys on data only.
- **C (severe, model face): link refusals flattened to a generic message.** pnpm installed a second `@veren/notebook` instance nested under `notebook-app`; the tool's `instanceof` check used the other class identity → always false → `internalError()`. Unit tests could not catch it (single module graph). Fix: structural identification via the framework's `remoteErrorOf()` (`isDSHRemoteError` marker + code prefix), per the framework's own "never instanceof" convention. Regression test added (foreign-instance shape); 34/34 green. Re-verified on the node: full three-part refusal now reaches the model.

## 3. Other findings (non-blocking)

1. Deep links (`/apps/notebook/list?probe`, `/apps/notebook/note/:id`, cold tab) do not create page sessions; the SPA restores the previous session. Needs separate investigation (suspected host-shell issue).
2. Transient `owners` fetch failure was a symptom of B's socket exhaustion; not seen after the fix.
3. The documented zombie-process trap recurred (`dsh web` children surviving kills → EADDRINUSE, stale node serving); handled per the known recipe.

## 4. Node end state

- `@veren/notebook-bundle@^3.0.0-rc.1` installed (floating, registry); duplicate instance removed and did not reappear after reinstall.
- The node carries hot-fixed dists (equivalent to the future rc.2); source fixes are uncommitted in the workspace.

## 5. Pending (rc.2 release train)

1. Commit the four source fixes + this report;
2. Bump family to `3.0.0-rc.2` → publish → staging 3100 → 3080 reinstall from registry (dropping hot-fixed dists);
3. `3.0.0` final + market index (per design doc §12 P4);
4. File the deep-link issue separately.
