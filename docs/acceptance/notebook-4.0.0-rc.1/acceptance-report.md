# notebook 4.0.0-rc.1 True-Machine Acceptance Report (3080 stable node)

> Date: 2026-11-02. Subject: `@veren/notebook(-app/-ui/-bundle) @4.0.0-rc.1` (local tarball install, unpublished).
> Node: `deepseek\.dsh` (DSH_HOME explicit, port 3080, web profile, pnpm 11).
> Task book: `docs/notebook-note-types.cn.md` (three lifecycle kinds: fleeting/permanent/project + promote/trash/archive + the ledger readout).
> Verdict: **7 of 10 checklist items pass; 3 items' model face is blocked by one host-layer defect (③⑤⑥; their code paths carry composition-test coverage); one design gap was found live and fixed on the spot (defect E); two toolchain bugs in the install path were fixed along the way.**

---

## 1. Ten-item checklist

| # | Item | Result | Evidence |
|---|------|--------|----------|
| ① | Upgrade path: existing cards land as permanent, zero migration | ✅ | Medium proof: after opening, all **11 pre-kind rows remain on disk without any `kind` field (no conversion, no rewrite)**, the 8 link rows intact, `linksSyncedAt:1` did not re-trigger; the domain opened with those rows = the schema default reading them as permanent works. UI badge pass skipped due to the shell automation trap (§3.4); the medium + startup stand as the judges |
| ② | Fleeting capture: dangles allowed, filter correct | ✅ | Live model face: `capture_note` returned `kind:"fleeting"`, title auto-minted from the first line, the dangling `[[还不存在的卡]]` accepted; `list_notes(kind:fleeting)` returned exactly the fleeting card, permanents filtered; the medium's `links` table gained zero rows = off the graph |
| ③ | promote: refusal + success halves | ❌ blocked | Blocked live by defect D (the note detail page refuses to open, §2); the code face is covered by `app.pages.spec` (note-page registration assertions) + lifecycle.spec |
| ④ | Blind test: AI proactively proposes promote/trash for overdue fleeting | ✅✅ | Open question ("anything in my card box I should look at?", zero hint words): the AI read all 13 cards, then named "**the fleeting queue has 2 backed up — by the box's own rule they should be processed within a day or two**", judged both rc7 cards "pure test phrases with nothing to distill" (pointing at trash), and even caught the media-surgery fingerprint (updatedAt earlier than createdAt, same millisecond = backfill). The list page's first screen rendered "**进料口（2 条，均已过期，应当先加工）**" live |
| ⑤ | trash: fleeting deletable, no TTL | ⚠️ half | No-TTL proven by ④+⑧ (2 fleeting cards set 3 days back survived three restarts); the delete click-through shares ③'s blockage |
| ⑥ | archive: distill-back evidence first | ❌ blocked | Same as ③ (archive_note is page-scoped). Its creation-path gap is fixed (defect E) |
| ⑦ | A permanent card cannot link a fleeting one | ✅ | Live refusal text: `these link targets have no card in this notebook: [[rc7闪念二号：纯粹的提醒物]]` — fleeting cards are not addresses |
| ⑧ | box_stats/ledger + restart persistence | ✅ | The `ledger` (2 captured rows) + the 2 fleeting cards survived **three node restarts**; the box_stats model face is blocked by defect D (page-scoped), its arithmetic covered by stats unit tests |
| ⑨ | Global face exactly five; promote/archive page-only | ✅✅ | A non-page session's model self-reported: exactly capture/find/list/read/write **5 tools**; promote_note / archive_note / box_stats each answered "absent" |
| ⑩ | Clean uninstall, lossless reinstall | ✅ | After `dsh plugin remove`: zero of the four packages left in node_modules, the profile dependency rows gone, **all 13 stored cards intact**; reinstalling 4.0.0-rc.1 succeeded |

## 2. Defect D (host layer, blocking ③⑤⑥'s model face) — attributed, not fixed

- **Symptom**: opening `/apps/notebook/note/:noteId` by any route fails with `detail page "notebook/note" registered no tools; its write duty cannot be fulfilled` (the page-registry §3.10.5 mount-time audit).
- **Forensics** (temporary diagnostics in the profile runtime.js, since reverted): the `before` and `after` tool faces are **identical name-by-name**, delta zero — the note page body's six `agent.ctx.tools.register` calls **never landed in the session's tool face**; and the behavior is **boot-nondeterministic** (a session created under restart#2 showed the model 7 tools including body-registered list_hubs/box_stats; the same flow under restart#3 yields before==after).
- **Attribution**: the notebook family is exonerated — the dist/catalog/pages installed in the profile all carry the new builders (file-by-file verified), composition tests are green, and the list page/global face/medium all pass. The defect sits in page-registry/app-host's session tool-face snapshot versus body-registration landing; the note page's model face was admitted in the rc.1 report §3.1 as "completed via the panel's human face" — **it had never passed on a real host; this is a pre-existing defect surfacing today** (the app menu made page opening possible for the first time).
- **Disposition**: handed to the page-registry/app-host lane; all diagnostic patches reverted (the profile runtime.js was restored byte-level from the npm-published tarball).

## 3. Fixed on the spot

### Defect E (notebook family, fixed, ships with the rc line): project cards had no creation path

- **Symptom**: the state machine's `project` state was unreachable from the tool face — capture_note carried no anchor, write_note only writes permanent cards; surfaced while driving the acceptance live.
- **Fix**: `capture_note` gained `anchor?` (a task-workbench taskId) — **an anchored capture lands as a project card** (same loose discipline: title optional, links may dangle, off the graph); service/port/description/tests updated in one line (a blank anchor refuses with `input-invalid`).
- **Regression**: lifecycle.spec's project-creation case now rides the real capture path (the row-surgery shim is gone); package tests all green.

### Two toolchain items (notebook-bundle repack.mjs)

1. Member tarball filenames assumed the bundle's version — app-host-bundle rides its own 2.2.1 line and would break; now resolved by each member's own tarball.
2. On win32, node spawning GNU tar directly: the drive colon reads as a remote host and `--force-local` does not save it (verified on this box) — the script gained forward-slash + force-local handling (still failing), **tonight's repack ran manually in bash** (tar works inside MSYS); a pure-node rewrite is the follow-up.

### Install-path note

- Local install flow: `pnpm pack` five packages → rewrite the bundle and member cross-deps to `file:` → `dsh plugin --profile web add <bundle.tgz>`.
- The profile's bundle dependency currently points at a **TEMP-dir file: path** (fine for a throwaway acceptance; after publishing it should return to the floating registry range).

## 4. Environment traps (newly catalogued)

1. **This harness's bash is MSYS and its mount table has no `/c`**: `/c/Users/...` resolved as a RELATIVE path into `D:\Program Files\Git\c\...` (cleaned up); the correct alias for the Windows temp is `/tmp` (per the mount table). Paths passed to native children must use the `C:/` forward-slash form.
2. **DSH shell automation**: synthetic clicks/Enter get swallowed by the periodic re-render — the only reliable channel is a page-context DOM click via `playwright.evaluate`; `dom_cua` second.
3. **Zombie `dsh web` processes** stacking three generations on 3080 again: CIM enumeration of CommandLine, kill one by one, verify the port at zero, as before.

## 5. Node end state

- `@veren/notebook-bundle@4.0.0-rc.1` (local tarball, file: deps) installed; the node serves normally on 3080.
- Test data: the standard box holds 13 cards (11 pre-existing permanent + 2 fleeting set overdue) + 2 ledger rows; the two overdue fleeting cards stay for a follow-up blind re-test.
- Remaining: after defect D (host layer) is fixed, ③⑤⑥'s model face and the "distill proposal" half of the blind test need one re-verification round.
