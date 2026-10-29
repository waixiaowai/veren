# The Unattended Page Work-Face Contract (18 pages compliant)

English | [中文](unattended-page-contract.cn.md)

**Status**: contract finalized; implement per the tables. The authorization
matrix (§5) lands first; each app's compliance spec instantiates its rows from
this file's fields and matrix.

## 0. Purpose and the two acceptance criteria (design intent, not reinvented)

docs/application-concept.md §0/§0.1: **the page session is where a task is
executed and settled** — delivery → open the URL's session → page tools mount →
finish the work inside the page → `task_complete` writes the result → report
back to the source app. A page passes on exactly two criteria:

- **(a) End-to-end completable**: a delivered task can be taken, executed, and
  completed with the tools this page mounts — never borrowing a "host-global
  tool" this page does not have;
- **(b) No human required**: when the work cannot be finished there is an
  escape — retry, lease-expiry back to the queue (§4.4), or a stable-code
  failure report. **No path may end with "waiting for the user".**

This file turns the two criteria into five checkable faces: action levels (§1),
the page-contract field (§2), completion evidence (§3), the autonomy budget
(§4), and the 18-page authorization matrix (§5). The checker is the reusable
test face `assertUnattendedPage` / `assertNoUnattendedStall` in
`@veren/test-support`; each app's `tests/` contract spec instantiates its own
matrix rows.

## 1. Action levels and the consent policy (derived, not per-page taste)

| Level | Definition | Test | Consent policy (unattended) |
| --- | --- | --- | --- |
| **L0 read-only** | changes no record, no external side effect | list/get/query/inventory; error paths write nothing | autonomous, no consent needed |
| **L1 reversible write** | reversible within the lease/session lifetime, or paired with an inverse / soft delete | take/release (lease recyclable), create/update, revoke (restore exists), vote (repeat retracts), archive/pin | autonomous; report with evidence on completion (§3). Authorizing signal = the delivery instruction (narrowed to a task id) or a user message this turn |
| **L2 destructive/external** | irreversible deletion, external money/notify side effects, destroying others' work | delete, refund, permanent takedown, ledger clearing | **roll back or refuse with a stable code; never suspend awaiting confirmation**. Refusal code `unattended/l2-refused`; rollback path = land a reversible draft or two-step consistency (create new, then retire old) |

Two derivation rules:

1. **The consent policy is derived from the level**: L0/L1 execute unattended;
   L2 rolls back or refuses. A human-present confirmation gate is **an optional
   enhancement for L2 only**, never part of the unattended path — writing
   "confirm with the user before writing" into an L0/L1 page's instructions
   declares that page's write tasks stall unattended, violating criterion (b).
2. **The legitimate trigger of a write tool (L1) = an unfakeable consent
   signal**, same vocabulary as docs/task-workbench-modes-dispatch.md §2: a
   user message this turn (`kind:'user'`), or a delivery notice
   (`task-center/notice` or an `app/task` block, narrowed to the task id). The
   read face is `session.deriveMessages()` — **not** `ownEvents()` (synchronous
   history reads are barred from new calls by DSH decision 2026-09-09). A
   first-screen autonomous turn (only `app/page` / `runtime-context`) has zero
   write permission.

## 2. The page-contract field (ComponentPageMeta extension)

`@veren/prompt-page`'s `ComponentPageMeta` gains an `unattended` field (a
type-face addition; no behavior change; absent = the page does not join the
unattended face and `assertUnattendedPage` stays silent):

```ts
/** The unattended work-face contract (docs/unattended-page-contract.md §2) */
export interface UnattendedContract {
  /** The kind of delivered tasks this page serves (one line) */
  readonly serves: string
  /** The page's action-level ceiling */
  readonly level: 'L0' | 'L1' | 'L2'
  /** The completion-evidence shape (§3; L0 fills 'read-only') */
  readonly evidence: string
  /** The failure escape (§0(b); L0 fills 'none-needed') */
  readonly escape: string
  /** The autonomy budget (§4; default = the lease is the bound) */
  readonly budget?: string
}
```

Checks (`assertUnattendedPage`):

- an L0 page's instructions must not steer toward write actions; an L2 page
  must name the stable refusal code or rollback path in `escape`;
- the page's mounted write tools' levels ≤ the page ceiling (mounted faces are
  checked against each package spec's "page → tool → level" list);
- `writes: true` matches the mounted write tools (the existing §3.10.1 rule-3
  check keeps working).

## 3. Completion evidence (definition of done)

A completion report must carry **machine-checkable evidence**; a verbal "done"
does not count:

- **Task-shaped**: `task_complete` requires `summary` plus `artifacts`
  (id/path/url references, never bulk content); it lands in the task center's
  `result` field, observable via the `task-center/completed` event and
  machine-queryable in storage;
- **Failure-shaped**: `task_fail` with a **stable code** (the closed set in
  task-center's `TaskErrorCode`, or app-defined `<app>/<code>`) + message,
  landing in the `failure` field;
- **Non-task-shaped** (a forum reply, a notebook note): a **one-sentence
  evidence report** on completion — naming the artifact (post id / note id /
  status field before→after), taken from the tool's return value, never
  invented.

Wording duty for page instructions: after a write tool succeeds, the model
must "report with one sentence naming the artifact", not "done".

## 4. The autonomy budget

- **Time bound = the lease** (§4.4 exists): 30 minutes, renewed on every task
  tool call; lazy expiry recycles to open — the backstop that keeps tasks from
  dangling, not a failure;
- **Turn/call bound = the settlement watch** (exists: person-agent's
  `createSettlementWatch`, `WATCH_DEFAULTS` as the single source): dispatched
  work has a reporting bound; at the bound it settles and the report never
  dangles;
- **Per-page declared budgets** go into `unattended.budget` (one line) and are
  relayed to the model by the page instructions; the host gains no new
  enforcement mechanism — the existing executable faces (lease + watch) are
  the boundary, and a gap needs "traversed the existing faces, confirmed
  absent" evidence before a separate proposal.

## 5. The authorization matrix (18 pages × action level; current → target)

Evidence line numbers for the current column were captured 2026-10-29.

| # | App · page | Mounted write tools (level) | Current | Target |
| --- | --- | --- | --- | --- |
| 1 | forum · catalog | `forum__post` (L1) | autonomous + honest clauses (reference) | L1, add contract fields |
| 2 | forum · post | `forum__comment`/`forum__vote` (L1) | autonomous (reference) | L1, add contract fields |
| 3 | person-agent · overview | ten session/workspace tools (L1) | autonomous + anti-passivity check + dispatch settlement (template) | L1, add contract fields |
| 4 | person-agent · workspaces | four workspace tools (L1) | autonomous | L1, add contract fields |
| 5 | notebook · list | `notebook__write_note` (L1) | autonomous | L1, add contract fields |
| 6 | notebook · note | `notebook__rewrite_note` (L1), `notebook__delete_note` (**L2**) | delete has a confirm gate; unattended = stall | L2 ceiling: rewrite L1 autonomous; delete unattended = "delivery instruction counts as consent, else refuse `unattended/l2-refused`" |
| 7 | sub2api-admin · home | none (overview L0) | blanket-confirm clause pollutes the console guidance | L0, guidance points to per-page dispatch |
| 8 | sub2api-admin · channels | `channels`/`request` (L1) | blanket confirm; unattended stall | L1 autonomous + evidence report |
| 9 | sub2api-admin · groups | `groups` (L1) | same | L1 |
| 10 | sub2api-admin · users | `users` (L1; balance outflow guarded by amount) | same | L1 |
| 11 | sub2api-admin · subscriptions | `subscriptions` (L1, revoke has restore) | same | L1 |
| 12 | sub2api-admin · finance | `payment` (refund/delete **L2**) | same | L2 ceiling: queries/cancel/retry/plan CRUD = L1 autonomous; refund/delete = L2 refusal gate |
| 13 | sub2api-admin · codes | `redeem_codes`/`promo_codes` (L1; delete/batch_delete **L2**) | same | L2 ceiling: generate/expire/update = L1; deletions = L2 refusal gate |
| 14 | sub2api-admin · accounts | `accounts` (L1, set_status reversible) | same | L1 |
| 15 | sub2api-admin · usage | `usage` (L0) | read-only (no confirm-clause issue) | L0, add contract fields |
| 16 | task-workbench · list | take/complete/release/requeue/open (L1, consent gate) | first-screen blanket ban (pages.tsx:133/150); ListMeta missing writes | browse/drive modes + consent gate; L1; honest empty state |
| 17 | task-workbench · detail | take_page/complete/fail/abandon/split (L1) | completion instruction points at host-global `task_complete/task_fail` (pages.tsx:223) — **unreachable** from page sessions (§6) | page-scoped complete/fail mounted here; L1 |
| 18 | task-workbench · publish | `publish_task` (L1, consent gate) | self-loop target (actions.ts:96) | target from the cross-app registry catalog; L1 |

All nine sub2api metas gain `writes: true` (all nine were missing it — write
tools mounted without the declaration, defeating the §3.9 cross-check).

## 6. The completion path: evidence and the general disposition (pre-implementation fact, 2026-10-29)

**Verdict: host-global `task_complete`/`task_fail` are unreachable from page
sessions.** Three pieces of evidence:

1. **Registration faces**: the global seven register on task-center's mounting
   host scope (task-center/src/service.ts:104, gated by `config.tools.enabled`);
   a page session's tool face is exactly what the page body registers at session
   creation (application-concept §3.4.2, "a tool exists only inside a page") —
   the two registration paths never intersect;
2. **The live checklist** (AGENTS.md stable-node checklist item 4, measured
   2026-10-21): the list-page session sees only the `task_workbench__take_task`
   set, the detail page only `abandon_task/complete_task/split_task/
   take_page_task`; person-agent's overview page once mounted zero tools — page
   sessions default to an empty tool face;
3. **Consequence**: DetailMeta's current instruction (pages.tsx:223) tells the
   model to finish delivered tasks "via the host-global task_complete/
   task_fail" — tools the page session does not have, so the delivery loop
   snaps at its last link (link 5 of the §5.3 loop).

**The general disposition (no new host mechanism)**, by page role:

- **The workbench's own pages** (rows 16–18): this app's own verb face is
  self-sufficient — `complete_task` settles the task-center record directly
  (summary required = the completion evidence); the failure escape is
  `abandon_task` back to the open queue / `requeue_task` to return or re-file,
  with lazy lease recycling as the backstop. Terminal states are
  machine-queryable (result/failure); nothing dangles.
- **Plain delivery-target pages** (forum/notebook, rows 1–6): mount
  task-center's `buildPageTaskTools` — the **page-scoped**
  `task_take`/`task_complete`/`task_fail` trio (the target url IS this page; no
  forgeable id; the claimant check provides the mutex). The names matching the
  global face **verbatim is deliberate**: the TASK block and inbox notice's
  standing guidance ("take with task_take… report with task_complete") then
  reads verbatim true in page sessions — no second vocabulary. Mechanics:
  task-center/src/page-face.ts + each app's assembly (urlOfSession over the
  page-registry instance index); unit tests in task-center
  tests/page-face.spec.ts, the cross-app loop dry run in
  tests/page-delivery-dryrun.

## 7. Compliance tests and mutation sensitivity (probes written before implementation)

The reusable checker lives in `@veren/test-support` (`page-contract.ts`); each
app's `tests/contract.spec.ts` feeds its matrix rows. Bidirectional mutation
sensitivity:

- remove notebook's delete gate (the L2 clause / refusal code) → red;
- add a blanket confirmation gate to forum (a stall phrase like "confirm with
  the user before writing" appears in the instructions) → red (the
  `assertNoUnattendedStall` text ban);
- remove the detail page's completion tools → red (the mounted-face
  sufficiency assertion);
- make `consentOf` always-true or strip the consent gate → the first-screen
  zero-write property test goes red.

## 8. Versions

Behavior-changing packages each take a MINOR bump: `@veren/prompt-page` (the
contract-field type), `@veren/task-center` (notice text gains the task-id
line), `@veren/task-workbench` (queue authority moves + consent gate + the
dispatch trio), `@veren/sub2api-admin` (nine-page clauses + writes + the L2
gate), `@veren/notebook-app` (delete's unattended escape), `@veren/forum-app` /
`@veren/person-agent-app` (contract-field declarations). All land as 2.3.0.
