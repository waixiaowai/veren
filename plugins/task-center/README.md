# @veren/task-center

## What this is

Host-level persistent task queue and personal inbox for DSH: tasks target a canonical page URL, move through open/taken/done/failed/expired/cancelled/orphaned with lease-based claiming and idempotent completion; notification delivery is tracked independently of task status. Use it when applications hand work items to a person; skip it for in-session todo lists or process-level background jobs.

## Status

Implemented (phase 1, session B). Two storage tables in the `task_center` storage domain: `tasks` (the work items) and `deliveries` (the notices), one row each per task/notice. `TaskCenterService` implements the frozen `TaskCenterContract` (`send/list/get/take/release/complete/fail/cancel`) on a single FIFO write chain with lazy expiry (`expiresAt`) and lazy lease recycling (`leaseUntil`). Completion and failure are idempotent. Extra, contract-additive seams: `pendingDeliveries()` / `markDelivered()` (session C injects these as user messages and reports the attempt back), `markAppOrphaned()` (uninstall marks open/taken tasks `orphaned`, never deletes), and `setAppResolver()` (lazy app-registry wiring, so this package never imports the registry). Model-facing tools: `task_list/task_get/task_take/task_complete/task_fail/task_cancel/task_split`. Do not change exported contracts without reporting.

Delivery scheduler (S1 optimization lane): the effects-core pump in `service-pump.ts`, built on [`@veren/effects`](../../packages/effects/README.md), with effect rows in their own `task_center_effects` storage domain (one row per pending notice, resumed across restarts). A pump attempt only mirrors the seam's decision table: a terminal task's notice flips to `read` in place (no longer depending on someone pulling), `failed`/`orphaned` stay pending, and a deliverable notice defers via `Later` until session C pulls it — the injection and receipt faces are unchanged. The pump's 2 s tick (the official pass-loop cadence) is this package's only timer.

Subtasks (§4.7): task records carry `parentId` (written once at creation, immutable) and `ancestorIds` (root-to-parent array), arbitrary depth; `addSubtask(parentId, draft)` is the only phase-1 split entry, bounded by the safety limits (depth ≤ 8, ≤ 32 children per node, ≤ 200 nodes per tree; over-limit returns `task/subtree-limit`). The mutex is tree-level: at most one session holds a `taken` node per tree; a parent `complete` requires a subtree with no non-terminal descendants (`task/children-active`); a `cancelled`/`expired`/`orphaned` ancestor cascades the whole subtree into the matching terminal state; subtasks never create delivery rows — the inbox shows roots only.

## Commands

```bash
pnpm --filter @veren/task-center typecheck
pnpm --filter @veren/task-center test
```

中文文档见 [README.cn.md](./README.cn.md)。
