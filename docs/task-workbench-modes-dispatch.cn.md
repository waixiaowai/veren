# 任务工作台三概念：推进（模式+同意门）、派发（跨应用 target）、导航（动作面）

[English](task-workbench-modes-dispatch.md) | 中文

**状态**：设计定稿，实现照表。状态迁移表（§3）与工具矩阵扩展表（§4）先行落地，实现与测试都以这两张表为准。

## 0. 诊断（全部有源码证据，不重取证）

截图里的"只读盘点然后等点名"是三处代码禁令/缺失的合成产物：

| # | 事实 | 证据 |
| --- | --- | --- |
| 1 | 首屏一刀切禁令："不要改动任务状态；仅在用户或投递指令明确要求时才接取/完成" | [pages.tsx:133](../plugins/task-workbench/src/pages.tsx#L133)、[pages.tsx:150](../plugins/task-workbench/src/pages.tsx#L150) |
| 2 | 推进无策略面：8 个工具全是单步原子操作，模型只能即兴 | `createAppTools`（[app.ts:147](../plugins/task-workbench/src/app.ts#L147)） |
| 3 | 派发自我循环：publish_task 硬编码 target 为自身详情页 | [actions.ts:96](../plugins/task-workbench/src/actions.ts#L96) |
| 4 | 能力地图按设计只含本应用兄弟页 | [runtime.ts:279](../plugins/page-registry/src/runtime.ts#L279) `MAP_HEADER` |
| 5 | 队列是 5 条内存示例，无持久化 | [store.ts:16](../plugins/task-workbench/src/store.ts#L16) `makeList` |

而跨应用的三块基石早就存在，只是没被工作台用起来：

- **TaskTarget 本就是跨应用模型**（url/appId/page/params，[types.ts:24](../plugins/task-center/src/types.ts#L24)）；
- **AppRecord.pages 是跨应用目录的权威投影**（[types.ts:47](../plugins/app-registry/src/types.ts#L47)），`ctx.apps.catalog()` 直接可读；
- **导航正门在位**：`pageRegistry.openUrl(url, { taskId, callerSessionId })`（[service.ts:204](../plugins/page-registry/src/service.ts#L204)——同 URL 自开由守卫幂等返回，taskId 打开即接取并追加 TASK 块）。

## 1. 设计总纲：用门替禁令，用队列替示例，用目录替硬编码

四个概念各一句话：

- **A 推进**：browse/drive 两模式 + 同意门（机制，不是措辞）。写工具的合法触发 = 本回合会话日志里有 `kind:'user'` 的人类消息（广域同意）或任务中心的投递指令（按任务 id 收窄的同意），且模型已用 `drive_begin` 声明本回合范围。
- **B 工单化首屏**：策略视图 = 确定性派生纯函数，把队列分成可接取/被租约持有/已派发/已退回/阻塞五条 lane，逐条带等待时长与是否需确认。
- **C 派发**：publish 直接以注册表目录选 target；`requeue_task` 把退回的任务重新入队（默认回本应用，可带 target_app 改派）。完成态经任务中心记录回传列表页，失败/孤儿回退回队列，绝不无声悬置。
- **D 导航**：`open_task_page` 走 `pageRegistry.openUrl` 正门（带回执），跨应用目录行进列表页正文（来源 = 注册表，逐条 URL 模板 + 用途一句话 + 在途派发数）。

### 1.1 队列权威搬家（B 与 C 的共同前提）

验收要求"重启 3080 后队列与租约持久性复核"，内存示例队列注定不合格。本设计把队列权威搬到任务中心（真实持久化存储），本地 `TaskStore` 降级为页面会话的首屏投影：

- 每条工作单对应任务中心记录（`send` 落库 + 投递行）；示例任务改为首次打开列表页时懒播种子（`idempotencyKey = task-workbench/sample-<n>`，重启靠去重不重播）。
- 本地条目以 `wb-<记录id>` 为 id（URL 跨重启稳定），链接字段只有三个：`activeRecordId`（当前执行载体）、`dispatchedTo?`（改派去向）、`attempts`（派发次数）。
- 重启后投影重建是纯函数：入站 = `target.appId === 'task-workbench'` 的记录；出站 = `idempotencyKey` 以 `task-workbench/` 开头的记录。

## 2. 同意门规格（A 的机制面）

**信号源（不可伪造，走"处理刚投递事件"的 sanctioned 路径）**：同步扫描历史事件（`ownEvents`/`snapshotEvents`）已被 DSH 弃用且禁止新调用（Agent Note 2026-09-09）。正门是 `ctx.on('session/event', …, { global: true })` 增量折叠——page-registry 的回执台账（[receipts.ts:83](../plugins/page-registry/src/receipts.ts#L83)）是在先先例（global 是硬要求：scopeTarget 载体派发，非 global 一个事件都收不到）。真机日志实证的事件顺序（2026-10-29 解码 `deepseek/.dsh` 会话日志）：`turn/start` **先于**本回合的全部 `user/message` 提交，随后才是步进循环——因此"turn/start 重置、user/message 合并"的折叠语义恰好等于"最后一条 assistant 之后的切片"，且不受多步回合（每步一条 assistant/message）干扰。人类消息的 `source.kind = 'user'`（`MessageSourceMap` 基础词汇，[message.d.ts:101](../deepseek/deepseek-harness/packages/llm/llm/lib/types/message.d.ts#L101)）；投递通知 = `task-center/notice`；TASK 块 = `app/task`。模型无法伪造这三者——它们由泵、宿主与会话系统写入。台账按 `WeakMap<Session, TurnConsent>` 存活，随会话对象回收；插件未观察到过的会话（含重启恢复）= 空状态 = 拒写（fail-closed），下一次人类/投递唤醒自然重新武装。

**判定规则（纯函数 `consentOf(events)`）**：

| 切片内出现 | 授予 | 范围 |
| --- | --- | --- |
| `kind:'user'` 消息 | 用户同意 | 广域：本回合 drive 声明的任意范围 |
| `task-center/notice` 文本 | 投递同意 | 仅文本中 `任务：<id>` 点名的任务 |
| `app/task` 块（`TASK <id> …`） | 投递同意 | 仅块头点名的任务 |
| 只有 `app/page` / `runtime-context` 等 | 无 | 首屏自主回合 = 零写权限（旧反例被机制挡住） |

**drive 台账（WeakMap<Agent, DriveGrant>）**：`drive_begin { scope, reason }` 校验切片同意后登记本回合范围（`scope: 'turn'` 仅限用户同意；投递同意只能声明被点名任务）。台账随 agent 对象生灭，无泄漏无清理负担；废弃会话重挂后新 agent 无台账 = 回到 browse。

**写工具统一入口（`gate.write`）**，失败即稳定 code，模型可据此恢复：

| 检查序 | 失败 code | 语义 |
| --- | --- | --- |
| 1 切片同意 | `consent/required` | 本回合没有用户消息也没有点名本任务的投递指令 |
| 2 drive 台账 | `consent/drive-required` | 有同意但 browse 未声明；先 `drive_begin` |
| 3 范围覆盖 | `consent/scope-exceeded` | 目标任务 id 不在本回合声明范围内 |

**变异红线**：把 `consentOf` 改成恒真、或把写工具的 gate 摘掉，性质测试"未经同意的写被拒"必须变红（测试直接调动作体，喂首屏形态的事件切片）。

## 3. 状态迁移表（守卫 + 后置动作）

记录（任务中心，权威）与工作单（工作台投影）两层，各自一表。

### 3.1 任务中心记录（既有语义，照抄为权威）

| 迁移 | 守卫 | 后置动作 | 出处 |
| --- | --- | --- | --- |
| open → taken | CAS(revision)；他人租约未过期拒绝 `task/already-taken`；expired/orphaned 拒绝；树级互斥 `task/another-active` | 写租约 + `task-center/changed` | [service-mutations.ts:34](../plugins/task-center/src/service-mutations.ts#L34) |
| taken → open | 仅 taken（release）；租约懒过期扫入同效 | 摘 claimedBy | [service-mutations.ts:70](../plugins/task-center/src/service-mutations.ts#L70) |
| taken → done | 仅 taken；摘要必填；子树有非终态后代拒绝 `task/children-active` | 写 result + `task-center/completed` | [service-mutations.ts:96](../plugins/task-center/src/service-mutations.ts#L96) |
| taken → failed | 仅 taken；不级联（子树事实保留） | 写 failure | [service-mutations.ts:138](../plugins/task-center/src/service-mutations.ts#L138) |
| open → cancelled | 非 taken 非 terminal；父取消级联整树 | `task-center/changed` | [service-mutations.ts:164](../plugins/task-center/src/service-mutations.ts#L164) |
| → expired / orphaned | 过期只对 open；应用卸载扫入 | 保留记录不删除 | service-tree sweep / orphanAppTasks |

### 3.2 工作单 lane（工作台投影，策略纯函数按当前载体记录派生）

| lane | 判定（对 activeRecordId 记录） | 需确认 | 合法动作 |
| --- | --- | --- | --- |
| `takeable` | open 且 target.appId = task-workbench 且未过期 | 否（drive 可自动接） | take_task / requeue(改派) |
| `dispatched` | open 且 target.appId ≠ task-workbench | 是 | open_task_page / requeue(改派) |
| `held` | taken（显示接取会话与租约到期） | 是 | open_task_page |
| `completed` | done（显示摘要） | — | （历史行） |
| `returned` | failed 或 orphaned | 是 | requeue_task（回到 open 或改派）——唯一出路口 |
| `stale` | expired / cancelled | — | （历史行；requeue 也可救活 cancelled 前的 open→ 不，cancelled 是记录终态，requeue 建新记录） |

**不丢不变式（性质测试 P1）**：任意操作序列后，每条非终态记录要么落在队列（takeable/dispatched lane），要么被活租约持有（held 且 leaseUntil 未过期）。终态记录是历史行，不算丢。

### 3.3 requeue 的两步一致性

`requeue_task { task_id, target_app? }`（target 缺省 = 本应用自身详情页）：

1. 先 `send` 新记录（target_app 来自注册表校验；`idempotencyKey = task-workbench/<itemId>/<targetApp>-a<n+1>`）——失败则整步无副作用；
2. 再 `cancel` 旧载体记录（仅当旧记录仍 open；taken/终态则跳过 cancel——taken 说明有人正在干，拒绝改派 `dispatch/conflict` 后回滚新记录 cancel）。

## 4. §3.10.1 工具矩阵扩展表（先表后码）

| 工具（全名 `task_workbench__*`） | 挂载页 | writes | 门 | 变化 |
| --- | --- | --- | --- | --- |
| `list_tasks` | list | 否 | — | 升级：返回策略视图（五 lane + 等待时长 + 需确认标记），数据源 = 任务中心实时 |
| `get_page_task` | detail | 否 | — | 升级：正文 = 中心记录 + 中心子树（ancestorIds 前缀查询） |
| `take_task` | list | 是 | gate + 中心 CAS | 升级：中心接取（租约）+ 本地投影同步；参数加 summary 无需——接取不写摘要 |
| `take_page_task` | detail | 是 | gate（投递同意按 id 收窄） | 保留 + 门 |
| `complete_task` | list+detail | 是 | gate + 接取者校验 | 升级：中心 complete（摘要必填参数）+ 投影同步 |
| `abandon_task` | detail | 是 | gate + 接取者校验 | 升级：中心 release（回 open 队列） |
| `split_task` | detail | 是 | gate + 接取者校验 | 保留（addSubtask，target 继承受中心校验） |
| `publish_task` | publish+list | 是 | gate | 升级：`target_app?`/`page?` 来自注册表目录；缺省 = 本应用详情页（旧行为） |
| `requeue_task` | list+detail | 是 | gate + returned lane 守卫 | **新增**：退回/改派（§3.3 两步一致性） |
| `drive_begin` | list+detail+publish | 否（状态） | 内验切片同意 | **新增**：声明本回合范围与理由 |
| `drive_end` | list+detail+publish | 否 | — | **新增**：显式收回（可选卫生动作） |
| `open_task_page` | list+detail | 是（导航） | gate | **新增**：走 openUrl 正门，返回 {sessionId,url,title} 回执；同 URL 自开幂等（宿主守卫） |

派发目标校验（publish/requeue 共用）：target_app 必须在 `ctx.apps.catalog()` 且 state=active；page 缺省 = 该应用 entry（规则 1 保证 entry 无 `:param`）；显式 page 带 `:param` 拒绝 `dispatch/target-invalid`（工作台不替别的应用编参数）。

## 5. 派发闭环 = 既有动词的分解（不加宽）

| 环节 | 动词 | 既有面 |
| --- | --- | --- |
| 1 发布/改派 | publish_task{target_app} / requeue_task | `channel.send`（TaskCenterContract.send，落库 + 投递行） |
| 2 目标应用知悉 | 泵注入 notice（新会话）或 page_send 转投（活会话） | pumpDeliveries（[runtime.ts:391](../plugins/page-registry/src/runtime.ts#L391)）+ noticeText（补 `任务：<id>` 行，[service-delivery.ts:86](../plugins/task-center/src/service-delivery.ts#L86)） |
| 3 目标接取 | 全局 `task_take`（不入工作台门） | tools.ts 全局七件 |
| 4 目标干活/拆分 | 其自有工具 + `task_split`（子树 target 继承，中心校验一致） | createSubtask |
| 5 完成回传 | `task_complete`/`task_fail` → 记录翻 done/failed | completeTask/failTask + `task-center/completed` 事件 |
| 6 列表页可见 | 策略视图实时 `channel.list` + 子树进度（ancestorIds 前缀） | 本设计 §3.2 |
| 7 拒绝/超时退回 | failed → `returned` lane → requeue_task；租约过期 → 中心扫入 open → `dispatched` lane 恢复 | §3.3 + sweep |

## 6. 导航动作面（D）

- `open_task_page { task_id }`：解析任务载体记录 target.url → `pageRegistry.openUrl(url, { taskId?, callerSessionId })` → 返回 `{ sessionId, url, title }` 回执。taskId 传入时目标页接取并收 TASK 块（§5.3 闭环正门）；同 URL 自开由宿主守卫幂等返回。
- 跨应用目录行进**列表页正文**（不碰宿主 componentPageBlock——那是本应用兄弟页的既有语义）：列表页组件体从装配期绑定的 `ctx.apps.catalog()` 派生逐应用行：`- <appId> <entryUrl> → 一句话用途（在途派发 n 条）`，只列 active 应用。验收问询（清单 #12）判定来源自述必须是这份目录。

## 7. 验收探针（实现前写好，全部外部裁决）

**性质测试（vitest，包级 tests/property.spec.ts）**：

- **P1 任务不丢**：随机操作序列（publish/take/complete/abandon/dispatch/requeue/fail）后断言 §3.2 不丢不变式；每个序列跑真实任务中心服务 + 内存存储。
- **P2 未同意写被拒（变异变红）**：首屏形态事件切片（仅 app/page + runtime-context）→ take/complete/dispatch/requeue 全部 `consent/required`；变异体（consentOf 恒真 / 摘 gate）同输入必须放行——测试断言放行路径存在且与门路径互斥。
- **P3 派发至多一次送达 + 可退回**：同 idempotencyKey 二次 send 返回同一记录；returned → requeue → 新 open 记录、旧记录保留为历史。

**3080 真机清单扩充（沿用编号，8–12）**：

8. **drive 回合日志**：用户点名推进一条任务 → 日志须见 `drive_begin` → `take` → … → `complete` 调用序列与一句话确认；看什么——序列完整、无未声明 id 的写；通过标准——全程无 `consent/*` 拒绝且无越范围写。
9. **首屏零写**：不开口新建 list 会话 → 首回合零写工具调用；看什么——审计 CLI `writeOnFirstTurn` 无新增；通过标准——模型尝试写时收到 `consent/*` 拒绝（如发生）。
10. **派发回环**：publish{target_app: person-agent} → person-agent 会话用其自有工具 + task_take/task_complete 完成 → 列表页策略视图显示 completed（target.appId = person-agent，子树进度前移）。
11. **退回**：目标应用 task_fail（或租约过期）→ 列表页 returned/dispatched 恢复 → requeue_task 后新记录 open。
12. **跨应用地图问询**（第七条问法）：问"要处理某条任务应打开哪个 URL，你从哪里知道的" → 回答含目标 URL 且来源自述为列表页正文目录（非 target.url 推断）。

**字节审计**：`node scripts/audit-page-context.mjs --home deepseek/.dsh --json` 改前/改后各跑一遍，数字贴 §8。

**持久性**：重启 3080 后队列（种子不重播、派发单仍在）与租约（重启前 taken 的记录仍 held）复核。

**旧七条**：全部保持通过（措辞类断言按新说明句更新后复跑）。

## 8. 字节审计（改前基线 → 改后）

改前（2026-10-29，`--home deepseek/.dsh`）：pageSessions 等全量数字见提交时的验收记录附录；关键行——`firedWriteFirstTurn` 历史值、`generations` 分档。改后数字在本节更新，判定：新说明句代际（G6-gate）零首回合写。

## 9. 版本与发布

`@veren/task-center`、`@veren/task-workbench` 内容变更 → 统一升位 **2.3.0**（MINOR=新能力）；registry 发布走晋升流水线（不在本任务验收内）。
