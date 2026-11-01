# task-workbench domain (领域模型)

> Decision record for the task-workbench app plugin. English is primary; Chinese
> key terms stay in parentheses. Every invariant names the test that guards it;
> one without a guard is marked `unguarded`. Declared faces at the bottom are
> checked by `scripts/check-docs.mjs` (docs → code, one-way).
> 本文件是 task-workbench 的决策沉淀：概念表 + 不变式 + 拒绝清单 + 已知妥协。
> 每条不变式标注守护测试；无守护的标注 `unguarded`。文末声明面由 check-docs 门禁校验。

## Concepts (概念)

| Concept | Definition | Rules it keeps |
| --- | --- | --- |
| Work order (工作单) | One node in the task subtree, carried by the task center's `TaskRecord`; the workbench projects it, it never owns it | The center is the single authority for status/lease/settlement; the page's body is an open-time projection plus tool results |
| Page = settlement place (页面=任务执行结算场所) | A page session is where a delivered task is taken, executed and settled — not a dashboard | Every page mounts its own working tools (§3.10.1 matrix); a page without tools cannot be a delivery target |
| Tool matrix (工具矩阵) | 12 tools in three halves: queue (`list/take/complete/publish/requeue/open_task_page`), page (`get_page_task/take_page_task/split_task`), drive+abandon (`drive_begin/drive_end/abandon_task`) | Local names ≤ 24 chars, unique in-app; full name = `task_workbench__<local>` (§3.4.3); a tool exists only mounted on a page |
| Consent gate (同意门) | Write tools run only inside a turn's consent: a user message, or a delivery naming the task id; browse mode declares scope via `drive_begin` first | Legal triggers are unfakeable signals (§2 of docs/task-workbench-modes-dispatch.cn.md); undeclared scope is refused with `consent/scope-exceeded`, missing consent with `consent/required` |
| TaskTarget (跨应用派发模型) | A work order's `target: { url, appId, page, params }` — the cross-app dispatch address | Delivery opens the target URL and lands the TASK block there; the target page's own tool face settles the task |
| Store projection (投影) | An in-memory synchronous projection (`TaskStore`) of the center's records, rebuilt from `channel.list()` | Read-only for pages; the queue's real body arrives as a first-screen followup message; rebuilds after any center read |

## Invariants (不变式)

1. **Reopening one URL always creates a fresh session and deprecates the old
   one (§9.1 反转)** — the index points at the newest live session; the old one
   is marked `deprecated`, its agent retires and its leases release, but its
   log stays readable. Never a "same URL = same session" resume.
   Guard: `plugins/page-registry/tests/runtime-open.spec.ts` 「①同一 URL 连开两次 →
   两条不同会话；索引指向后一条，前一条状态为废弃」+ ② agent 退役; across a real
   restart: `plugins/task-workbench/tests/acceptance-app-sessions.spec.ts` 场景 3.
2. **A page session cannot reach the host-global `task_*` tools (页面会话不可达
   宿主全局 task_\*)** — a page session sees only what its body registers; the
   settlement face must be mounted by the target page itself (the page task
   trio, or the workbench's own `complete_task`/`abandon_task` center-first
   face). Evidence: docs/unattended-page-contract.cn.md §6 (2026-10-29 取证).
   Guard: `plugins/task-workbench/tests/app-page-face.spec.ts` 「每个工具都至少登记在
   一个页面上（无死工具）」+ 「每页登记的工具都在说明里点名（挂了就要说）」— the
   unreachability verdict itself is evidence-based, `unguarded` as a property.
3. **Promise = mount (承诺=挂载)** — every tool named in a page's hand-written
   text is mounted on that page; cross-page naming is a false promise.
   Guard: `plugins/task-workbench/tests/app-page-face.spec.ts` 「发布页不点名
   split_task（越页点名就是假承诺）」; workspace-wide: `check:model-surface` gate.
4. **Write tools pass the consent gate; first-screen autonomous turns (only
   `app/page` / runtime context) have zero write power** — the delivery turn's
   consent is narrowed to the named task id.
   Guard: `plugins/task-workbench/tests/property.spec.ts` P2 「未经同意的写被拒（变异掉
   同意门必须变红）」+ `tests/app-consent-writes.spec.ts` 「同意门下的写流程（真实中心）」.
5. **The center is authoritative; the store is a projection** — every write goes
   through `TaskChannel` → task center; the store rebuilds from center reads and
   never farms state back.
   Guard: `plugins/task-workbench/tests/subtree.spec.ts` 「rebuildFrom（队列权威在中心的投影）」
   + property.spec.ts P1 「任务不丢（随机操作序列下的不变式）」.
6. **A delivered task is settled, never suspended (绝不悬置)** — completion via
   `complete_task` (summary required; `task/children-active` while non-terminal
   descendants exist), giving up via `abandon_task` back to the open queue, or
   `requeue_task` re-dispatch; lease expiry lazily recycles.
   Guard: `plugins/task-workbench/tests/acceptance-tasks.spec.ts` 场景 6 (发任务 → 通知 →
   接取 → 完成); the escape-path wording itself `unguarded`.
7. **The first screen is an open-time snapshot; the real body rides a followup
   message** — pages read projections synchronously, fetch truth in their own
   `ctx.effect`, and deliver via `agent.followup` (`app/page` source); the host
   never fetches for them.
   Guard: `plugins/task-workbench/tests/app-page-face.spec.ts` 「首页正文取真实投影数据
   （换 store 首屏随之变，不许写死）」.

## Known compromises (已知妥协)

- **G5: the store does not survive a restart (内存 store 重启重置)** — `TaskStore`
  is in-memory by design; after a host restart the first screen renders empty
  until the first center read rebuilds it. Accepted on 2026-10-25 (验收在案),
  listed in docs/optimization-plan.cn.md G5, not fixed. `unguarded`.
- **The list page's unattended escape names `abandon_task`, which is mounted on
  the detail page only** — caught by the `check:model-surface` gate's first
  report; ledgered in the gate's KNOWN_DRIFTS pending a wording fix. `unguarded`.
- The passive-inventory list posture (被动盘点列表) is a relic of the era when
  page callbacks were banned from touching ctx lifecycle directly (now the
  `check:page-api` gate with `ctx.page.*`); the list page keeps read-only
  inventory as its browse face, writes ride the consent gate. Historical note.

## Rejected (拒绝清单)

| Rejected | Reason |
| --- | --- |
| Owning task records in the workbench (本地存储任务) | The center is the single settlement authority; two copies would race on lease/settlement |
| Host-global tools as the completion face (靠宿主全局 task_complete) | Page sessions cannot reach them (invariant 2); the delivery loop snapped at its last link |
| "Wait for the user" as a failure path (等用户) | Violates the unattended contract §0(b): every path ends in a settled record or a stable-code failure |
| Mounting all 12 tools on every page (全量挂载) | Tool scope is the anti-sprawl boundary: the list page takes, the detail page settles; cross-page visibility invites out-of-scope writes |
| Splitting subtasks at publish time (发布时带子任务模板) | The claimant splits in place on the detail page (§4.7.6); the publisher cannot know the execution shape |
| Session reuse on reopen (URL 复用会话) | §9.1 inversion: a fresh open must not inherit a stale tool face or a deprecated agent's state |

## Declared faces (check-docs 声明面)

- tool: `list_tasks`
- tool: `take_task`
- tool: `complete_task`
- tool: `publish_task`
- tool: `requeue_task`
- tool: `open_task_page`
- tool: `get_page_task`
- tool: `take_page_task`
- tool: `split_task`
- tool: `abandon_task`
- tool: `drive_begin`
- tool: `drive_end`
- service: `taskCenter`
- page: `/apps/task-workbench`
