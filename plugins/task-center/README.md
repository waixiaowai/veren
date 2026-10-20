# @veren/task-center

## What this is

Host-level persistent task queue and personal inbox for DSH: tasks target a canonical page URL, move through open/taken/done/failed/expired/cancelled/orphaned with lease-based claiming and idempotent completion; notification delivery is tracked independently of task status. Use it when applications hand work items to a person; skip it for in-session todo lists or process-level background jobs.

## Status

Implemented (phase 1, session B). Two storage tables in the `task_center` storage domain: `tasks` (the work items) and `deliveries` (the notices), one row each per task/notice. `TaskCenterService` implements the frozen `TaskCenterContract` (`send/list/get/take/release/complete/fail/cancel`) on a single FIFO write chain with lazy expiry (`expiresAt`) and lazy lease recycling (`leaseUntil`) — no timers. Completion and failure are idempotent. Extra, contract-additive seams: `pendingDeliveries()` / `markDelivered()` (session C injects these as user messages and reports the attempt back), `markAppOrphaned()` (uninstall marks open/taken tasks `orphaned`, never deletes), and `setAppResolver()` (lazy app-registry wiring, so this package never imports the registry). Model-facing tools: `task_list/task_get/task_take/task_complete/task_fail/task_cancel`. Do not change exported contracts without reporting.

## Commands

```bash
pnpm --filter @veren/task-center typecheck
pnpm --filter @veren/task-center test
```

中文文档见 [README.cn.md](./README.cn.md)。
