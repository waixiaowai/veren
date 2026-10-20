# @veren/task-center

## 这是什么

DSH 宿主级持久任务队列与个人收件箱：任务以规范页面 URL 为目标，按 待办/进行中/完成/失败/过期/取消/孤儿 状态机流转，接取带租约、完成幂等；通知投递状态与任务状态是两条互不推导的轴。当应用需要把工作项交给人处理时使用；会话内 todo 清单、进程级后台 job 不走这里。

## 当前状态

第 1 阶段已实现（会话 B）。存储域 `task_center` 两张表：`tasks`（任务）与 `deliveries`（通知）。`TaskCenterService` 在一条 FIFO 串行写链上实现冻结的 `TaskCenterContract`（`send/list/get/take/release/complete/fail/cancel`），懒过期（`expiresAt`）与懒租约回收（`leaseUntil`），无后台定时器；complete/fail 幂等。契约之外的增量接缝：`pendingDeliveries()` / `markDelivered()`（会话 C 在会话启动时注入通知文本，并回报投递结果）、`markAppOrphaned()`（卸载把 open/taken 任务标 `orphaned`，只保留不删除）、`setAppResolver()`（惰性接线应用注册表，本包不 import 注册表实现）。模型工具：`task_list/task_get/task_take/task_complete/task_fail/task_cancel/task_split`。契约导出（尤其错误码）改动必须先报告。

子任务（§4.7）：任务记录带 `parentId`（创建时写一次、不可变）与 `ancestorIds`（根→父数组），支持任意层级；`addSubtask(parentId, draft)` 是第 1 阶段唯一拆分入口，受安全上限约束（深度 ≤ 8、单节点 ≤ 32 子、单树 ≤ 200 节点，超限 `task/subtree-limit`）。互斥为树级：整棵树同一时刻至多一条会话持有 `taken`；父 `complete` 要求整棵子树无非终态后代（`task/children-active`）；父 `cancelled`/`expired`/`orphaned` 时整棵子树级联进入对应终态；子任务不产生投递行，收件箱只出根任务。

## 常用命令

```bash
pnpm --filter @veren/task-center typecheck
pnpm --filter @veren/task-center test
```

English docs: [README.md](./README.md)。
