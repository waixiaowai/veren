# @veren/task-center

## 这是什么

DSH 宿主级持久任务队列与个人收件箱：任务以规范页面 URL 为目标，按 待办/进行中/完成/失败/过期/取消/孤儿 状态机流转，接取带租约、完成幂等；通知投递状态与任务状态是两条互不推导的轴。当应用需要把工作项交给人处理时使用；会话内 todo 清单、进程级后台 job 不走这里。

## 当前状态

第 1 阶段已实现（会话 B）。存储域 `task_center` 两张表：`tasks`（任务）与 `deliveries`（通知）。`TaskCenterService` 在一条 FIFO 串行写链上实现冻结的 `TaskCenterContract`（`send/list/get/take/release/complete/fail/cancel`），懒过期（`expiresAt`）与懒租约回收（`leaseUntil`），无后台定时器；complete/fail 幂等。契约之外的增量接缝：`pendingDeliveries()` / `markDelivered()`（会话 C 在会话启动时注入通知文本，并回报投递结果）、`markAppOrphaned()`（卸载把 open/taken 任务标 `orphaned`，只保留不删除）、`setAppResolver()`（惰性接线应用注册表，本包不 import 注册表实现）。模型工具：`task_list/task_get/task_take/task_complete/task_fail/task_cancel`。契约导出（尤其错误码）改动必须先报告。

## 常用命令

```bash
pnpm --filter @veren/task-center typecheck
pnpm --filter @veren/task-center test
```

English docs: [README.md](./README.md)。
