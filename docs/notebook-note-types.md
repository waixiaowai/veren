# notebook Note-Type Lifecycle Task (four-question deepened, v2)

Status: in execution (chartered 2026-11-02)
Related: `docs/notebook-zettelkasten-design.md` (rc.1 design; its write-time-discipline decision is re-examined here), `docs/notebook-roadmap.cn.md` (M1–M5)

## 0. First principle (global adjudication standard)

> The more you learn and collect, the more useful your notes become, the more ideas combine and spark new ideas, and the easier it gets to write an excellent article.

This is the first principle of the Ahrens slip-box method: **the box is a compounding machine**. Every design decision in this task is judged by the flywheel:

- **Classification is feedstock management, not managerial tidiness.** Fleeting = intake (fast capture, value undecided); permanent = compound product (write-only, grows more valuable); project = work in progress (distilled back into the box at closure — the flywheel forbids value stranded in dead projects).
- **A fleeting note's "thrown away within a day or two" is legal only after its value has been transferred** (promoted into a permanent card) — trash is removing the residue after compounding, not scheduled deletion.
- **The M5 outlet (from box to article) is out of scope here**, but the classification design must not block it (a permanent card's shape must be directly assemblable into an article skeleton).
- **Whether the flywheel turns is decided by numbers** (see §6 metrics), never by the implementer's own word.

## 1. Current-state forensics (checked 2026-11-02)

- `NoteRecord` (`plugins/notebook/src/types.ts:54`) carries only `id/owner/title/body/createdAt/updatedAt` — no classification field.
- "Classification is a query, not a schema" is the standing position (`staleView` comment in `graph.ts`); `staleView` (no inbound links, older than `STALE_DAYS=7`) is the only lifecycle signal.
- Not classifying was an explicit design decision (`notebook-zettelkasten-design.cn.md:197`): discipline moved from review time to write time (one card one idea + links must pre-exist) — that position **in effect sides with Matuschak's evergreen approach**, in tension with Ahrens' fleeting→permanent pipeline; §3 adjudicates explicitly.
- No fleeting/permanent/project traces anywhere in the source; `delete_note` refuses when referenced (card-referenced); no trash, no TTL.

## 2. The task

Land the Ahrens classification as a **lifecycle with terminal actions**, not a label field. Seven legs:

1. **Research first (no code before it)**: read the four-types chapter of Ahrens (*How to Take Smart Notes*, both Chinese and English editions) verbatim and extract each type's invariants (storage place / lifespan / write discipline / terminal action) into the table in §3; cover the flywheel chapters too. Read Matuschak's evergreen counter-position and Luhmann's own practice; state which side the plugin's current write-time discipline actually sits on. The user names three types (fleeting/permanent/project), Ahrens has four (literature notes anchor on bibliographic data this plugin lacks) — the adjudication criterion: **does the flywheel need a distinct reading-intake state?**
2. **Adjudicate the semantics of "throw away"**: a fleeting note's terminal state is "promoted to permanent **or** explicitly trashed (precondition: value transferred — operationalized as no unconsumed outgoing-link value)", never TTL auto-deletion. Decide the relation between the current `STALE_DAYS=7` waiting list and the fleeting window (replace / coexist / rename).
3. **State machine and dual entry**: types = states; transitions = explicit tool actions (promote/trash/archive, each with preconditions); the fleeting entry relaxes the current write-time discipline (unresolved links allowed, no title discipline). One tool with a kind parameter vs two tools with different disciplines — decided on evidence. For project notes, forensically check task-workbench's Task/TaskTarget; if no anchor exists, cut the type and say so — no empty labels. If kept, distill-back at closure (archive precondition) is mandatory.
4. **Schema adjudication**: explicit column vs derived, per type, mixing allowed; changing `NoteRecord` is MAJOR (3.0.0 is on the rc line — bump rc before touching). Migration backfill rules plus one verification script proving zero-manual placement.
5. **Property tests**: each invariant becomes an executable vitest property — an overdue fleeting note can only be promoted or explicitly trashed, with an executable trash precondition; `delete_note` on a permanent card must refuse; archive checks undistilled inbound links first.
6. **Metrics**: measure the flywheel, not just cleanup — **combination rate** (link-density slope vs card count), **spark rate** (riddle→new-card conversion), disposal rate (overdue fleeting promote+trash share), waiting-list trend. Landed as tool or panel numbers.
7. **True-machine acceptance**: stable node 3080, each item with "what to look at / pass standard"; includes a blind test — a fresh box must see the AI proactively propose promote/trash for overdue fleeting notes.

## 3. Invariants table (research output, backfilled 2026-11-02)

| Type | Storage | Lifespan | Write discipline | Terminal action | Source |
| --- | --- | --- | --- | --- | --- |
| Fleeting | one box, one intake entry (`capture_note`) | a day or two (float window `FLEETING_DAYS=2`; **never auto-deleted** — expiry only floats the card to the top) | fast and rough: title optional (minted from the first line); `[[…]]` may dangle — unresolved, off the link graph | promoted into a permanent card, or explicitly deleted (throwing the residue — the discipline lives in the tool description, the mechanism does not block) | Ahrens, fleeting chapter: fleeting notes are reminders, "thrown away within a day or two" presupposes processing |
| Literature | **folded into fleeting** (no separate state) | same as fleeting | taken while reading, in your own words — a content discipline of capture, not a lifecycle state | same as fleeting | Ahrens, literature chapter; adjudication #1 |
| Permanent | the box proper (visible to the link graph) | never thrown away | one card one idea, title = complete phrase = address, `[[…]]` must resolve, self-contained | none (write-only); deletion stays guarded by card-referenced | Ahrens, permanent chapter + Matuschak C1–C3 (the standing write-time discipline, unchanged) |
| Project | a project anchor (task-workbench `TaskItem.id`, weak anchor) | the project's life | loose (whatever serves the project); carries the anchor | archive: distill-back first (`distilledInto` must name existing permanent cards), then deletion — discarded at project end | Ahrens, project chapter: "discarded once the project ends"; distill-back is the flywheel's hard requirement |

## 4. Adjudication record (2026-11-02, fixed before code)

1. **Three vs four → three types.** The literature note's distinguishing feature is provenance metadata (bibliographic data), not a lifecycle state — it lives and dies like a fleeting note (process → permanent or discard). This plugin has no bibliographic domain; adding a provenance layer would be a new responsibility domain (bigger, not deeper). Reading intake folds into capture_note's description discipline. The criterion from §2.1 — "does the flywheel need a distinct reading-intake state" — answers no: it needs a discipline, not a state.
2. **The semantics of throwing away → trash is an explicit action, no TTL, no timer.** Expiry only changes visibility (the intake queue floats overdue cards first), never deletes a row. It coexists with `STALE_DAYS=7` with separate meanings: the fleeting intake window is 2 days (the user's definition), the lost-card window is 7 days (Luhmann C4, permanent/project cards only). **Explicit deviation from §2.5**: "delete_note on a permanent card must refuse" is not adopted — the mechanical protection that matters is the card-referenced guard (present, tested); an outright ban dead-ends cleanup of duplicate/mistaken cards and violates this repo's subtraction discipline; Ahrens's "never thrown away" is the box's value theory, not API semantics.
3. **Dual entry → two tools, not one tool with a kind parameter.** capture_note (fleeting: title optional, links may dangle) and write_note (permanent: one idea + resolve-refusal) are two disciplines a single schema cannot teach — an extension of D8's "the discipline lives in the tool descriptions". promote_note / archive_note are the explicit transition verbs. **Scopes**: capture_note joins the global face (capturing anywhere is the point of an inbox); promote/archive stay page-side (processing wants the card's first screen open, alongside rewrite/delete).
4. **Schema → an explicit kind column, overtaking the rc.1 design's §3.1 rejection of a type field.** The old reason "derivable from body" holds for tags/outbound but **not** for kind: the fleeting/permanent distinction at creation time (the same fresh unlinked card could be either) and the project anchor (an external entity) are not body-derivable; the archive precondition check (distill evidence) needs explicit state. `kind: 'fleeting'|'permanent'|'project'`, defaulting to permanent — every pre-kind v1 row parses as permanent via the zod default, zero-migration (all existing cards were written under the permanent discipline, provably correctly placed); the domain version stays 1. NoteView/NoteSummary gain kind: a breaking output widening on the rc line.
5. **Project anchor → a weak anchor on the task-workbench taskId.** Evidence: `TaskItem.id` really exists (`plugins/task-workbench/src/types.ts:24`). The anchor is format-validated only (non-empty string), zero hard dependency (no task-workbench inject); the semantics are taught in the tool description. The type is not cut: the anchor is real and the user named project notes explicitly.
6. **Graph visibility → fleeting cards are invisible to the link graph.** No `links` cache rows, never resolvable as a `[[…]]` target, absent from hubs/backlinks/riddles/the waiting list. Only compounded cards join the network — the structural expression of the flywheel, and what keeps I3 true while a fleeting body may dangle. **Invariant I2 is amended accordingly**: title uniqueness narrows to "unique among link-target (non-fleeting) cards" — fleeting cards are not addresses, duplicates are unambiguous; this keeps the intake free of title-collision friction. Uniqueness/rename/delete semantics among permanent/project cards stand unchanged.
7. **Metrics → a `ledger` table + the `box_stats` tool.** An append-only action ledger (captured/promoted/trashed/archived/riddle_closed); box actions are human-scale so the ledger stays tiny; rates are windowed at 7 days. Riddle-closure detection: when a rewrite adds a direct link and the pair shared >= RIDDLE_MIN_SHARED neighbors with no prior direct link either way → a riddle_closed row (the mechanically measurable part of the spark rate; "riddle seen and rejected" is honestly unmeasured).
8. **Version → `4.0.0-rc.1` (amended during execution).** The original call was `3.0.0-rc.7`, but a parallel release train shipped 3.0.0 final into the immutable registry mid-task (commit 7f8a0fd); this widening (NoteRecord/NoteView/NoteSummary/NotebookErrorCode/NotebookToolsPort — the error-code union expansion is a compile break for exhaustive switches, the rc.1 design's D11 MAJOR criterion) lands on the new MAJOR line `4.0.0-rc.1` per the versioning convention, riding -rc.N through staging first. The whole family rises on one line.

## 5. External adjudicators (acceptance is not ours to grant)

1. Source text: every implemented rule traces to an Ahrens/Luhmann quote, or an explicitly reasoned deviation.
2. Mature implementations' actual behavior: The Archive (zettelkasten.de) et al. on fleeting notes — TTL? trash? Cross-implementation comparison.
3. Property tests: mechanical adjudication of the state-machine invariants.
4. Flywheel numbers: combination/spark rates, reference = Luhmann's box output history (~90k cards → 70 books, 400 papers).
5. Blind test: fresh box, the AI must proactively propose promote/trash for overdue fleeting notes.

## 6. True-machine acceptance checklist (3080, backfilled 2026-11-02)

Each item: what to look at / pass standard. Install the family bundle on the stable node first (DSH_HOME=deepseek\.dsh).

1. Upgrade path: existing cards all visible after the upgrade, each badge reading permanent — the v1 rows parse as permanent via the schema default (zero-migration proof).
2. capture_note writes a fleeting card carrying an unresolved `[[x]]` — succeeds; visible under list_notes(kind: fleeting); absent from hubs/backlinks/riddles/the waiting list.
3. promote_note on that card with a dangling link → refused link-unresolved; with the link resolved → kind flips to permanent, the card joins the graph.
4. Intake blind test: a fleeting card past its 2-day window floats in the first screen's intake section; in a fresh session the AI proactively proposes promote-or-trash for it.
5. Throw semantics: delete_note removes a fleeting card; nothing auto-expires (a card untouched for a week is still there after a restart).
6. archive_note: a project card + distilledInto naming a real permanent card → the card is gone and the ledger has the row; distilledInto pointing at a fleeting/missing id → refused archive-undistilled.
7. write_note linking a fleeting title → refused (a fleeting card is not an address).
8. box_stats returns kind counts, density, the intake queue, and the 7-day rates; the ledger survives a restart.
9. Scopes: the global face carries five tools (list/find/read/write/capture) in a non-page session; promote/archive appear only on the note page.
10. Uninstall the bundle → clean teardown, no orphan registrations.
