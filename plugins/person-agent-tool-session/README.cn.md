# @veren/person-agent-tool-session

Person Agent 预设的面向模型会话维护工具：基于 `ctx.sessionController` 的 `session_create`、`session_rename`、`session_fork`、`session_dispatch`，以及基于 `ctx.workspaceRegistry` 的 `session_archive`、`session_unarchive`、`session_pin`、`session_unpin`。

## 什么情况下使用

当 Person Agent 会话需要创建、派活或整理兄弟会话——按预设/模型/标题开新会话、把任务（包括第一句话）交给它且不阻塞自己、分叉已完成轮次、归档或置顶会话——时使用；当会话不允许改动会话名单时跳过。

## 最小配置

由 preset 作为子行组合（无需 `cordis.patch.yml`，加载器按包名加载）：

```yaml
- id: tool-session
  name: '@veren/person-agent-tool-session'
  config:
    allowCreate: true
    allowDispatch: true
    allowFork: true
    allowArchive: true
    allowPin: true
    maxReportChars: 4000
    maxConcurrentWatches: 64
```

## 工具

| 工具 | 参数 | 效果 |
| --- | --- | --- |
| `session_create` | `title?`、`presetId?`、`provider?`+`model?`、`workspaceId?` 与 `cwd?` 二选一 | 创建普通会话，然后按「先模型、后标题」的顺序补装。新会话从空白开始；工具只回报新 id，不切换会话。 |
| `session_dispatch` | `prompt`、`sessionId?` 与 `newSession?` 二选一、`report?` | 通过宿主标准入队路径（`resolveAgent` → `agent.followup`）把一段提示投进会话并**立即返回**，绝不等目标会话。`report: true`（默认）时由看守观察到目标真正静止，再把它的收尾输出作为 follow-up 消息投回**调用方**会话；`report: false` 时什么也不回。桥梁人设把任务交给新建会话（包括第一句话）就靠它。 |
| `session_rename` | `sessionId`、`title` | 持久修改一个会话的标题。 |
| `session_fork` | `sessionId`、`atSeq?` | 把精确的已完成轮次前缀复制成新会话。 |
| `session_archive` | `sessionId`、`stopActivity?` | 把会话放进归档集合；给 `stopActivity` 时停止运行中的工作而不是拒绝。 |
| `session_unarchive` | `sessionId` | 把归档会话移回原位。 |
| `session_pin` / `session_unpin` | `sessionId` | 维护 registry-global 置顶集合。 |

错误是结构化的，带稳定 code（`SESSION_TITLE_EMPTY`、`SESSION_CREATE_LOCATION_CONFLICT`、`SESSION_MODEL_SELECTION_INCOMPLETE`、`SESSION_DISPATCH_NO_CALLER`、`SESSION_DISPATCH_PROMPT_EMPTY`、`SESSION_DISPATCH_TARGET_MISSING`、`SESSION_DISPATCH_TARGET_CONFLICT`、`SESSION_DISPATCH_TARGET_NOT_FOUND`、`SESSION_DISPATCH_CREATE_FAILED`、`SESSION_DISPATCH_CAPACITY_REACHED`）与机器可读字段；注册表层级的拒绝（会话仍在运行、归档会话置顶）原样来自宿主接缝。

## 结算回报

`session_dispatch` 取代了旧的 `session_prompt`：后者的 `wait: true` 会阻塞调用方直到目标空闲（本部署实测 16 分钟），而它的 `wait: false` 正是新工具的非阻塞子集——同一个派活动作没有理由存在两个工具。

看守照抄官方子 agent 的结算观察者——`@deepseek-ai/dsh-subagent` 的 `src/manager.ts` 里的 `watchLocalSettlement()` / `settlementState()` / `wake()`。那段代码把**同步通知**与**异步静止**分开，本插件保持同一划分：

- **同步唤醒。** 挂在目标 Agent 自己上下文上的 `agent/inbox/inserted`、`agent/inbox/claimed`、`agent/inbox/discarded`（`agent.ctx.on(...)`）只负责结清并换新观察令牌。`@deepseek-ai/dsh-scope` 按作用域路由这些事件，因此收到的只会是这个 Agent 的通知，插件里不存在任何 `sessionId` 比对。
- **异步静止。** 常驻协程 `await agent.whenIdle()` 后读令牌：等待期间被换过就是 `retry`；还有输入没跑就是 `wait`（停在"下一次唤醒"上，不空转）；`ready` 才收尾。判据必须用 `whenIdle()`，因为 maintenance 任务运行期间公开状态仍是 `idle`——所以看守不订阅 `agent/status`，也不排任何定时任务。

消息声明了两种来源 kind，刻意分开：`session-dispatch`（`form: 'relay'`）是调用方撰写的内容，`session-dispatch-notice`（`form: 'notice'` + `summary`）是 runtime 对目标下场的陈述。合并两者会让目标被安上它没说过的话。

### 目标为什么停下

通知会说明**原因**，词汇与官方 `SubagentStopReason` 一致，让模型在两种派活路径之间读到同一套说法：

| 下场 | 通知措辞 |
| --- | --- |
| `completed` | "finished and will do no further work unless you send it more." |
| `aborted` | "was stopped before it finished." |
| `max-tokens` | "ran out of room before it finished." |
| `refusal` | "declined the task." |
| `error` | "failed before it finished." |
| `target-gone` | "left the runtime before it was observed settling; its work may be incomplete." |

归因复用官方 `foldConsumedWork`（来自 `@deepseek-ai/dsh-agent`）：单看轮次边界回答不了这个问题——一个在第一步之前停下的轮次与一个平衡的空转轮次形状完全相同，孤立读轮次不是把被截断的活记成完成，就是把每个空转都定罪。对它的结果做的分支照抄官方 `epochStopReason`。已记录的失败优先于取消；被后续已提交轮次取代的失败不再决定下场（官方 `observeLocalFailure` 的规则）。有两条语义绝不合并：`refusal` 意味着 pre-step 拒绝丢弃了已认领的输入，调用方**不能**当作任务完成；无法命名的下场按失败汇报，而不是当成成功。

### 折什么、从哪折

看守订阅目标自己作用域上的 `session/event`，从这段事件后缀折三件事：官方 `foldConsumedWork` 的结算归因、收尾输出、失败取代。`session/event` **只记账不唤醒**——唤醒观察者的只有 inbox 三件事与 `agent/error`，与官方观察者一致。

收尾输出用官方 `AssistantOutputFold` 的规则：最后一条**非空** assistant 消息（空内容、例如只带 usage 的消息不替换更早的输出），没有任何消息时回退到累积的流文本。该官方类位于本工作区不可解析的 `@deepseek-ai/dsh-subagent`，所以按同一语义实现在 `watch.ts` 里，并复用官方的 `joinAssistantStreamText`。

判定之前，看守会记下目标会话当时的 seq、best-effort 刷一次（官方的 `flushFinalState` 手法），然后**重新**判定：状态或 seq 只要在 flush 期间动过，就回到循环重判，绝不拿着 flush 之前的结论去报告。flush 失败只告警，不阻断通知。

### 让目标自己汇报

当目标确实能回话时，派发会把官方 `withContinuableReturnGuidance` 那段文本追加在调用方提示之后，让目标自己发一条自足的结果，而不是靠调用方去读它的对话记录。

门槛是刻意收窄的：`send_message` 只允许**相邻血统**——发信人只能发给直属父级，驻留的可续子级也只能发给直属父级——而普通的派发目标是一个没有父级血统的根会话。所以只有目标的 `parentSession` 正是调用方、**且** `send_message` 在目标作用域里可见时，才会追加指导；其余情况什么都不追加，而不是让目标去调用一个必然被拒的工具。

### 观察一次派发

每次被接受的派发都会在调用方作用域上广播 `session-dispatch/start`；带回报的派发在通知投递后广播 `session-dispatch/end`，按 `watchId` 配对。结束事件带终局原因与收尾输出，因此宿主与界面不必读会话日志就能显示"已派出、进行中"，随后显示结果。纯派发只广播 start，因为它没有可观察的结算。

### 未实现：派发记录落盘

官方的 catalog 会往父会话追加一条 `subagent/catalog`，让已完成的子级保持可发现。对插件而言，harness 的对应物是 `appendPluginRecord`——它写入一条 `ignorable` 记录，读方保留并跳过，且能随 fork 与 resume 一起留存。这里有两道障碍：

- `appendPluginRecord` 在本插件运行时解析到的 `@deepseek-ai/dsh-session@0.2.0-rc.2` 里**根本不存在**（只有更新的 checkout 构建版有），调用它会直接失败。
- 改用 `session.append` 写一条私有事件类型是**不安全**的：持久化读路径会拒绝含有 `KNOWN_SESSION_EVENT_TYPES` 之外事件类型的日志，除非该事件带 `ignorable: true`，而这个集合是从 harness 仓库生成的——也就是说调用方会话之后会**拒绝加载**。

不过这次派发其实已经被持久记录了：harness 为 `session_dispatch` 本身写入 `tool/call` 与 `tool/result` 事件，结果里的收据带着 `sessionId`、`messageId`、`watchId`。这些事件随重启与 fork 留存，并可用会话日志工具读取。

### 官方有、这里不能照搬的两项

官方的两项结果能力对一个「只是被观察」的会话并不适用，照搬等于造没有生产者的接口：

- **`structured`（`outputSchema`）** 是 *provider 请求*字段，不是 `subagent` 工具的模型参数。manager 靠往**子级自己的 Context** 注入一个结构化提交运行时来挂上它（`manager.ts` 的 `attachStructuredRuntime(childCtx, …)`），而 `out-of-process.ts` 明确标记外部 provider 不支持它。在这里提供它，意味着往一个属于用户的会话里注入提交工具与终结守卫。
- **`diagnostic`** 只由外部 provider 产生，大小由 `out-of-process.ts` 的 `MAX_SUBAGENT_DIAGNOSTIC_BYTES` 界定。本地 activation 的 `captureLocalResult` 从不设置它，所以观察本地会话的插件根本没有生产者可读。

通知按官方 `sendWaking` 的判据投递：调用方空闲用 `followup`（自成一轮），忙碌用 `steer`（并入最近的 step 边界，忙碌的调用方不会被迫多跑一轮）。调用方 Agent 已不在注册表时（宿主重启过），回退到 `ctx.sessionController.resolveAgent` 恢复它——与 `@deepseek-ai/dsh-schedule` 到期投递同一路线。

## 实现说明

- `src/index.ts` — 插件身份、开关与 effect 托管的注册（逆序清理，HMR 安全）。
- `src/tools-management.ts` — 走 `ctx.sessionController` 的创建/改名/分叉。
- `src/tools-dispatch.ts` — 走 `resolveAgent` + 结算看守的 `session_dispatch`。
- `src/watch.ts` — 结算看守：inbox 唤醒源、观察令牌与收尾输出选取。
- `src/notice.ts` — 两种消息 kind、结算通知与 `sendWaking` 投递。
- `src/tools-state.ts` — 走 `ctx.workspaceRegistry` 的归档/置顶动词。
- `src/types.ts` — 参数/返回值契约与结构化错误类型。

## 已知限制

- 看守不跨插件卸载：它由注册 effect 拥有，卸载即取消挂起的看守，且不补报。
- 没有等待上限。一个永不静止、也永不被销毁的目标会一直被看守到卸载；`maxConcurrentWatches` 限定这类看守能积累多少个。
- 看守会缓存目标会话在本次看守期间的事件。事件是共享的冻结值，所以这是一个引用数组而非拷贝，但一个跑得极久的目标仍会把它涨到结算为止。
- 看守是外部观察者：它会在收尾前复查会话 seq，但不能像官方 manager 关闭子级那样关闭目标的输入准入（`runMaintenance`）。落在复查之后的投递由下一次看守汇报，而不是这一次。
- 看守不会像官方 manager 在父级子树正在关闭时用 `parent.inject` 那样把通知停放下来；投不出去的通知记一条 warning 后被丢弃。
- 无法命名的下场与无法命名的 `turn/end` reason 都按 `error` 汇报、绝不报成功；该分支只能通过可扩展合并触达。

## 延伸阅读

- 宿主 Session 业务 API：`@deepseek-ai/dsh-api-session-controller`（`ctx.sessionController`）。
- 归档/置顶语义：`@deepseek-ai/dsh-workspace`（`ctx.workspaceRegistry`）。
- 工具契约：`@deepseek-ai/dsh-tools`（`defineTool`、`ctx.tools.register`）。
- 本看守所对照的结算观察者：`@deepseek-ai/dsh-subagent`（`src/manager.ts`、`src/continuation-messages.ts`）。
