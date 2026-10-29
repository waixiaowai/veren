# Task Workbench, Three Concepts: Drive (modes + consent gate), Dispatch (cross-app targets), Navigation (action face)

[中文](task-workbench-modes-dispatch.cn.md) | English

**Status**: design frozen; implementation follows the tables. The state-transition table (§3) and the §3.10.1 matrix extension table (§4) land first — implementation and tests both take these two tables as their contract.

## 0. Diagnosis (all sourced; do not re-collect)

The "read-only inventory, then wait to be named" behavior in screenshots is the composite of three code-level bans/gaps:

| # | Fact | Evidence |
| --- | --- | --- |
| 1 | First-screen blanket ban: "do not change task status; take/complete only on explicit user or delivery instruction" | [pages.tsx:133](../plugins/task-workbench/src/pages.tsx#L133), [pages.tsx:150](../plugins/task-workbench/src/pages.tsx#L150) |
| 2 | No strategy face for driving: 8 tools are all single-step atoms | `createAppTools` ([app.ts:147](../plugins/task-workbench/src/app.ts#L147)) |
| 3 | Dispatch self-loop: publish_task hardcodes its target to the app's own detail page | [actions.ts:96](../plugins/task-workbench/src/actions.ts#L96) |
| 4 | The capability map is by-design app-internal (sibling pages only) | [runtime.ts:279](../plugins/page-registry/src/runtime.ts#L279) `MAP_HEADER` |
| 5 | The queue is 5 in-memory samples with no persistence | [store.ts:16](../plugins/task-workbench/src/store.ts#L16) `makeList` |

The three cross-app foundations already exist and were simply unused by the workbench:

- **TaskTarget is already a cross-app model** (url/appId/page/params, [types.ts:24](../plugins/task-center/src/types.ts#L24));
- **AppRecord.pages is the authoritative cross-app catalog projection** ([types.ts:47](../plugins/app-registry/src/types.ts#L47)), directly readable via `ctx.apps.catalog()`;
- **The navigation front door exists**: `pageRegistry.openUrl(url, { taskId, callerSessionId })` ([service.ts:204](../plugins/page-registry/src/service.ts#L204) — same-url self-open returns idempotently via the guard; opening with taskId takes the task and appends a TASK block).

## 1. Design thesis: gates replace bans, a real queue replaces samples, the catalog replaces hardcoding

One sentence each:

- **A Drive**: browse/drive modes + a consent gate (mechanism, not prose). A write tool fires legally only when the CURRENT turn's session log carries a human message (`kind:'user'`, broad consent) or a task-center delivery instruction (consent narrowed to the named task id), AND the model has declared this turn's scope via `drive_begin`.
- **B Ticket-style first screen**: the strategy view is a deterministic derived pure function partitioning the queue into five lanes — takeable / held / dispatched / returned / blocked — each with wait time and a needs-confirmation flag.
- **C Dispatch**: publish picks its target from the registry catalog; `requeue_task` returns a bounced task to the queue (default: back to this app; optional `target_app` re-files it elsewhere). Completion flows back through task-center records; failures land in the returned lane — never silently parked.
- **D Navigation**: `open_task_page` goes through the `pageRegistry.openUrl` front door (with a receipt), and the list-page body gains cross-app catalog rows (source = the registry, each row a url template + one-line purpose + in-flight dispatch count).

### 1.1 The queue's authority moves (shared prerequisite of B and C)

Acceptance demands "queue & lease persistence across a 3080 restart" — an in-memory sample queue can never pass. The queue's authority moves to the task center (real persisted storage); the local `TaskStore` becomes the page session's first-screen projection:

- Every work order is a task-center record (`send` persists + creates a delivery row); sample tasks are lazily seeded on the first list-page open (`idempotencyKey = task-workbench/sample-<n>`; restarts rely on dedup, not re-seeding).
- Local items id as `wb-<recordId>` (urls stay stable across restarts) and carry exactly three link fields: `activeRecordId` (current execution vehicle), `dispatchedTo?` (re-file destination), `attempts`.
- Post-restart projection rebuild is a pure function: inbound = records with `target.appId === 'task-workbench'`; outbound = records whose `idempotencyKey` starts with `task-workbench/`.

## 2. Consent gate spec (the mechanism behind A)

**Signal source (unforgeable; the sanctioned "process the delivered current event" path)**: synchronous scans of event history (`ownEvents`/`snapshotEvents`) are deprecated in DSH and prohibited for new calls (Agent Note 2026-09-09). The front door is an incremental fold over `ctx.on('session/event', …, { global: true })` — page-registry's receipt ledger ([receipts.ts:83](../plugins/page-registry/src/receipts.ts#L83)) is the precedent (global is a hard requirement: scopeTarget carrier dispatch; a non-global listener receives nothing). The live event order, verified by decoding a real `deepseek/.dsh` session log on 2026-10-29: `turn/start` commits **before** all of the turn's `user/message` events, then the step loop — so "reset on turn/start, merge on user/message" is exactly equivalent to "the slice after the last assistant", undisturbed by multi-step turns (one assistant/message per step). A human message carries `source.kind = 'user'` (the `MessageSourceMap` base vocabulary, [message.d.ts:101](../deepseek/deepseek-harness/packages/llm/llm/lib/types/message.d.ts#L101)); a delivery notice = `task-center/notice`; a TASK block = `app/task`. The model cannot forge these — the pump, the host, and the session system write them. The ledger lives in a `WeakMap<Session, TurnConsent>` and is reclaimed with the session object; a session the plugin never observed (including a post-restart resume) reads as empty = writes refused (fail-closed), and the next human/delivery wake re-arms it naturally.

**Verdict (pure function `consentOf(events)`)**:

| In the slice | Grants | Scope |
| --- | --- | --- |
| a `kind:'user'` message | user consent | broad: any scope the turn's drive declares |
| a `task-center/notice` text | delivery consent | only the task named by its `任务：<id>` line |
| an `app/task` block (`TASK <id> …`) | delivery consent | only the task named in the block header |
| only `app/page` / `runtime-context` etc. | none | a first-screen autonomous turn has zero write power (the old counter-example is blocked by mechanism) |

**Drive ledger (WeakMap<Agent, DriveGrant>)**: `drive_begin { scope, reason }` validates slice consent, then records this turn's scope (`scope: 'turn'` requires user consent; delivery consent may only declare the named tasks). The ledger lives and dies with the agent object — nothing to leak or dispose; a remounted session's fresh agent has no ledger = back to browse.

**Uniform write entrance (`gate.write`)**, stable codes on failure so the model can recover:

| Check order | Failure code | Meaning |
| --- | --- | --- |
| 1 slice consent | `consent/required` | this turn has neither a user message nor a delivery instruction naming this task |
| 2 drive ledger | `consent/drive-required` | consent exists but browse never declared; call `drive_begin` first |
| 3 scope cover | `consent/scope-exceeded` | the target task id is outside this turn's declared scope |

**Mutation red line**: make `consentOf` always-true, or strip the gate from a write tool, and the "unauthorized writes are refused" property test must turn red (the test calls action bodies directly with a first-screen-shaped event slice).

## 3. State transition tables (guards + post-actions)

Two layers — records (task center, authoritative) and work orders (workbench projection) — one table each.

### 3.1 Task-center records (existing semantics, adopted as the authority)

| Transition | Guard | Post-actions | Source |
| --- | --- | --- | --- |
| open → taken | CAS(revision); another holder's unexpired lease refuses `task/already-taken`; expired/orphaned refuse; tree mutex `task/another-active` | write lease + `task-center/changed` | [service-mutations.ts:34](../plugins/task-center/src/service-mutations.ts#L34) |
| taken → open | taken only (release); lazy lease-expiry sweep has the same effect | drop claimedBy | [service-mutations.ts:70](../plugins/task-center/src/service-mutations.ts#L70) |
| taken → done | taken only; summary required; non-terminal descendant refuses `task/children-active` | write result + `task-center/completed` | [service-mutations.ts:96](../plugins/task-center/src/service-mutations.ts#L96) |
| taken → failed | taken only; no cascade (subtree facts preserved) | write failure | [service-mutations.ts:138](../plugins/task-center/src/service-mutations.ts#L138) |
| open → cancelled | not taken, not terminal; cancelling a parent cascades the tree | `task-center/changed` | [service-mutations.ts:164](../plugins/task-center/src/service-mutations.ts#L164) |
| → expired / orphaned | expiry applies to open only; uninstall sweeps in | records kept, never deleted | service-tree sweep / orphanAppTasks |

### 3.2 Work-order lanes (workbench projection; the strategy pure function derives them from the active vehicle record)

| Lane | Verdict (on the activeRecordId record) | Needs confirmation | Legal actions |
| --- | --- | --- | --- |
| `takeable` | open && target.appId = task-workbench && not expired | no (drive may auto-take) | take_task / requeue (re-file) |
| `dispatched` | open && target.appId ≠ task-workbench | yes | open_task_page / requeue (re-file) |
| `held` | taken (shows claimant session + lease deadline) | yes | open_task_page |
| `completed` | done (shows summary) | — | (history row) |
| `returned` | failed or orphaned | yes | requeue_task (back to open, or re-file) — the only exit |
| `stale` | expired / cancelled | — | (history row) |

**No-loss invariant (property test P1)**: after any operation sequence, every non-terminal record is either in the queue (takeable/dispatched lane) or held by a live lease (held with an unexpired leaseUntil). Terminal records are history rows and do not count as lost.

### 3.3 requeue's two-step consistency

`requeue_task { task_id, target_app? }` (target defaults to this app's own detail page):

1. `send` the new record first (target validated from the registry; `idempotencyKey = task-workbench/<itemId>/<targetApp>-a<n+1>`) — on failure the step has zero side effects;
2. then `cancel` the old vehicle record (only while it is still open; taken/terminal skips the cancel — taken means someone is working it, refuse with `dispatch/conflict` and roll the new record back).

## 4. §3.10.1 Tool matrix extension table (table before code)

| Tool (full name `task_workbench__*`) | Mounted on | writes | Gate | Change |
| --- | --- | --- | --- | --- |
| `list_tasks` | list | no | — | upgraded: returns the strategy view (five lanes + wait times + needs-confirmation), live from the task center |
| `get_page_task` | detail | no | — | upgraded: center record + center subtree (ancestorIds prefix query) |
| `take_task` | list | yes | gate + center CAS | upgraded: center take (lease) + projection sync |
| `take_page_task` | detail | yes | gate (delivery consent narrowed by id) | kept + gate |
| `complete_task` | list+detail | yes | gate + claimant check | upgraded: center complete (summary required) + projection sync |
| `abandon_task` | detail | yes | gate + claimant check | upgraded: center release (back to the open queue) |
| `split_task` | detail | yes | gate + claimant check | kept (addSubtask; target inheritance validated by the center) |
| `publish_task` | publish+list | yes | gate | upgraded: `target_app?`/`page?` from the registry catalog; default = own detail page (old behavior) |
| `requeue_task` | list+detail | yes | gate + returned-lane guard | **new**: return / re-file (§3.3 two-step consistency) |
| `drive_begin` | list+detail+publish | no (state) | validates slice consent internally | **new**: declare this turn's scope and reason |
| `drive_end` | list+detail+publish | no | — | **new**: explicit withdrawal (optional hygiene) |
| `open_task_page` | list+detail | yes (navigation) | gate | **new**: through the openUrl front door, returns a {sessionId,url,title} receipt; same-url self-open is idempotent (host guard) |

Dispatch target validation (shared by publish/requeue): target_app must be in `ctx.apps.catalog()` with state=active; page defaults to the app's entry (rule 1 guarantees a parameter-free entry); an explicit page carrying `:param` refuses with `dispatch/target-invalid` (the workbench does not invent other apps' params).

## 5. The dispatch loop decomposed into existing verbs (no widening)

| Step | Verb | Existing face |
| --- | --- | --- |
| 1 publish / re-file | publish_task{target_app} / requeue_task | `channel.send` (TaskCenterContract.send: persist + delivery row) |
| 2 target learns | the pump injects the notice (fresh session) or page_send forwards (live session) | pumpDeliveries ([runtime.ts:391](../plugins/page-registry/src/runtime.ts#L391)) + noticeText (gains a `任务：<id>` line, [service-delivery.ts:86](../plugins/task-center/src/service-delivery.ts#L86)) |
| 3 target takes | global `task_take` (outside the workbench gate) | the global seven in tools.ts |
| 4 target works / splits | its own tools + `task_split` (subtree target inheritance, center-validated) | createSubtask |
| 5 completion returns | `task_complete`/`task_fail` → record flips done/failed | completeTask/failTask + the `task-center/completed` event |
| 6 list page sees it | the strategy view reads `channel.list` live + subtree progress (ancestorIds prefix) | this design §3.2 |
| 7 reject/timeout return | failed → `returned` lane → requeue_task; lease expiry → center sweep to open → back to the `dispatched` lane | §3.3 + sweep |

## 6. Navigation action face (D)

- `open_task_page { task_id }`: resolve the active vehicle record's target.url → `pageRegistry.openUrl(url, { taskId?, callerSessionId })` → return the `{ sessionId, url, title }` receipt. Passing taskId makes the target page take the task and receive the TASK block (the §5.3 loop's front door); same-url self-open returns idempotently via the host guard.
- Cross-app catalog rows go in the **list-page body** (the host's componentPageBlock is untouched — sibling pages are its existing semantics): the list body derives per-app rows from the assembly-bound `ctx.apps.catalog()`: `- <appId> <entryUrl> → one-line purpose (n in-flight dispatches)`, active apps only. Acceptance question (checklist #12) judges that the answer's stated source is this catalog.

## 7. Acceptance probes (written before implementation; all externally adjudicated)

**Property tests (vitest, package tests/property.spec.ts)**:

- **P1 no task lost**: after random operation sequences (publish/take/complete/abandon/dispatch/requeue/fail), assert the §3.2 no-loss invariant; every sequence runs against the real task-center service + in-memory storage.
- **P2 unauthorized writes refused (mutation turns red)**: a first-screen-shaped event slice (only app/page + runtime-context) → take/complete/dispatch/requeue all refuse `consent/required`; a mutated gate (always-true consentOf / gate stripped) must LET the same input through — the test asserts the pass-through path exists and is mutually exclusive with the gated path.
- **P3 at-most-once delivery + returnable**: a second send with the same idempotencyKey returns the same record; returned → requeue → a fresh open record while the old record stays as history.

**3080 live checklist additions (numbering continues, 8–12)**:

8. **drive turn log**: the user names one task to drive → the log must show the `drive_begin` → `take` → … → `complete` call sequence plus a one-sentence confirmation; look for — the complete sequence, no writes on undeclared ids; pass — no `consent/*` refusals and no out-of-scope writes.
9. **zero writes on the first screen**: open a fresh list session and say nothing → zero write-tool calls on turn one; look for — no new entries in the audit CLI's `writeOnFirstTurn`; pass — if the model attempts a write it receives a `consent/*` refusal.
10. **dispatch loop**: publish{target_app: person-agent} → the person-agent session completes it with its own tools + task_take/task_complete → the list strategy view shows completed (target.appId = person-agent, subtree progress advanced).
11. **return**: the target app task_fails (or the lease expires) → the list shows returned / the dispatched lane recovers → requeue_task yields a fresh open record.
12. **cross-app map inquiry** (the 7th item's phrasing): ask "which URL should be opened to handle this task, and how do you know" → the answer contains the target url and states its source as the list body's catalog (not inference from target.url).

**Byte audit**: run `node scripts/audit-page-context.mjs --home deepseek/.dsh --json` before and after; numbers go in §8.

**Persistence**: after restarting 3080, re-check the queue (seeds not re-sown, dispatch orders still present) and leases (records taken before the restart still held).

**Old seven items**: all keep passing (wording-level assertions updated to the new note phrasing first).

## 8. Byte audit (before baseline → after)

Before (2026-10-29, `--home deepseek/.dsh`): full numbers in the acceptance-record appendix of the landing commit; key rows — historical `firedWriteFirstTurn`, the `generations` split. After-numbers update this section; verdict: the new note generation (G6-gate) has zero first-turn writes.

## 9. Versioning & release

`@veren/task-center` and `@veren/task-workbench` changed → the line moves to **2.3.0** (MINOR = new capability); registry publishing rides the promotion pipeline (outside this task's acceptance).
