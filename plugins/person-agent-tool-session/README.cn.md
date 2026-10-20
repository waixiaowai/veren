# @veren/person-agent-tool-session

Person Agent 预设的面向模型会话维护工具：基于 `ctx.sessionController` 的 `session_create`、`session_rename`、`session_dispatch`，以及基于 `ctx.workspaceRegistry` 的 `session_archive`、`session_unarchive`、`session_pin`、`session_unpin`。会话分叉由 `session-fork-enhanced` 插件接管（`session_fork_with_options`，是原 `session_fork` 的严格超集）；本插件不再注册任何 fork 工具。

## 什么情况下使用

当 Person Agent 会话需要创建、派活或整理兄弟会话——按预设/模型/标题开新会话、把任务（包括第一句话）交给它且不阻塞自己、归档或置顶会话——时使用；当会话不允许改动会话名单时跳过。

## 最小配置

由 preset 作为子行组合（无需 `cordis.patch.yml`，加载器按包名加载）：

```yaml
- id: tool-session
  name: '@veren/person-agent-tool-session'
  config:
    allowCreate: true
    allowDispatch: true
    allowArchive: true
    allowPin: true
    maxReportChars: 4000
    maxConcurrentWatches: 64
```

## 工具

| 工具 | 参数 | 效果 |
| --- | --- | --- |
| `session_create` | `title?`、`presetId?`、`provider?`+`model?`、`workspaceId?`（省略继承调用方工作区） | 创建普通会话，然后按「先模型、后标题」的顺序补装。新会话从空白开始；工具只回报新 id，不切换会话。 |
| `session_dispatch` | `prompt`、`sessionId?` 与 `newSession?` 二选一、`report?`；`newSession` 内 `workspaceId?`（省略继承调用方工作区）、`agentPreset?` | 通过宿主标准入队路径（`resolveAgent` → `agent.followup`）把一段提示投进会话并**立即返回**，绝不等目标会话。`report: true`（默认）时由看守观察到目标真正静止，再把它的收尾输出作为 follow-up 消息投回**调用方**会话，并写明它答复的是哪一次派发。**一个目标同时只能有一条未结清的派发**：目标上还有没回报的派发时再派会被 `SESSION_DISPATCH_WATCH_BUSY` 拒绝；`report: false` 时什么也不回。桥梁人设把任务交给新建会话（包括第一句话）就靠它。 |
| `session_rename` | `sessionId`、`title` | 持久修改一个会话的标题。 |
| `session_archive` | `sessionId`、`stopActivity?` | 把会话放进归档集合；给 `stopActivity` 时停止运行中的工作而不是拒绝。 |
| `session_unarchive` | `sessionId` | 把归档会话移回原位。 |
| `session_pin` / `session_unpin` | `sessionId` | 维护 registry-global 置顶集合。 |

`session_create` 与 `session_dispatch` 的 `newSession` 只接受 `workspaceId`，
不接受 `cwd`：新会话永远属于某个工作区。显式给出 `workspaceId` 时用它；省略时
继承**调用方会话所在的工作区**。调用方自己也不在任何工作区时，创建以
`SESSION_CREATE_WORKSPACE_UNKNOWN` 失败并提示显式指定 `workspaceId`，绝不会退回
部署默认目录把会话丢进未分组。仍传 `cwd` 时，工具在 schema 校验之前以
`SESSION_CREATE_CWD_REMOVED` 拒绝，并明确提示改用 `workspaceId`。

错误是结构化的，带稳定 code（`SESSION_TITLE_EMPTY`、`SESSION_CREATE_WORKSPACE_UNKNOWN`、`SESSION_CREATE_CWD_REMOVED`、`SESSION_MODEL_SELECTION_INCOMPLETE`、`SESSION_DISPATCH_NO_CALLER`、`SESSION_DISPATCH_PROMPT_EMPTY`、`SESSION_DISPATCH_TARGET_MISSING`、`SESSION_DISPATCH_TARGET_CONFLICT`、`SESSION_DISPATCH_TARGET_NOT_FOUND`、`SESSION_DISPATCH_CREATE_FAILED`、`SESSION_DISPATCH_CAPACITY_REACHED`、`SESSION_DISPATCH_WATCH_BUSY`）与机器可读字段；注册表层级的拒绝（会话仍在运行、归档会话置顶）原样来自宿主接缝。

## 结算回报

`session_dispatch` 取代了旧的 `session_prompt`：后者的 `wait: true` 会阻塞调用方直到目标空闲（本部署实测 16 分钟），而它的 `wait: false` 正是新工具的非阻塞子集——同一个派活动作没有理由存在两个工具。

看守照抄官方子 agent 的结算观察者——`@deepseek-ai/dsh-subagent` 的 `src/manager.ts` 里的 `watchLocalSettlement()` / `settlementState()` / `wake()`。那段代码把**同步通知**与**异步静止**分开，本插件保持同一划分：

- **同步唤醒。** 挂在目标 Agent 自己上下文上的 `agent/inbox/inserted`、`agent/inbox/claimed`、`agent/inbox/discarded`（`agent.ctx.on(...)`）只负责结清并换新观察令牌。`@deepseek-ai/dsh-scope` 按作用域路由这些事件，因此收到的只会是这个 Agent 的通知，插件里不存在任何 `sessionId` 比对。
- **异步静止。** 常驻协程 `await agent.whenIdle()` 后读令牌：等待期间被换过就是 `retry`；还有输入没跑就是 `wait`（停在"下一次唤醒"上，不空转）；`ready` 才收尾。判据必须用 `whenIdle()`，因为 maintenance 任务运行期间公开状态仍是 `idle`——所以看守不订阅 `agent/status`，也不排任何定时任务。

消息声明了两种来源 kind，刻意分开：`session-dispatch`（`form: 'relay'`）是调用方撰写的内容，`session-dispatch-notice`（`form: 'notice'` + `summary`）是 runtime 对目标下场的陈述。合并两者会让目标被安上它没说过的话。

### 回报可归属

每条通知先给一行下场陈述，紧接一行写明它答复的是哪一次派发：收据、`session-dispatch/start` 与 `session-dispatch/end` 已经在用的那个 `watchId`、被派发消息的 `messageId`，以及提示原文折叠并截断成的一行回显。同一个 `watchId` 与 `messageId` 也作为 `session-dispatch-notice` 来源的字段随消息落盘，宿主与界面因此不必解析散文就能把通知配回它的派发。这两个字段加入之前写下的历史通知两者都没有，所以读方按可选处理。

### 一个目标同时只有一个未结清看守

看守的判据是**整个目标会话**的静止，所以同一目标上的两个看守会在同一瞬间以同一段收尾输出定案：调用方收到两条逐字相同、谁也对不上的通知，而先跑那条任务的结果永远不会送达——会话记录里也看不出丢了什么。这条规则由看守注册表自己持有：`arm()` 在同一个同步块里查账并登记，因此对已有未结清看守的目标以 `SESSION_DISPATCH_WATCH_BUSY` 拒绝并点名那个看守；`report: false` 的派发走 `deliverGuarded()`，守的是同一条线。两种路径的拒绝都发生在**投递之前**，被拒的提示从未进入目标。

`report: false` 的派发同样受此约束：被接进一个受看守会话的提示，会悄悄换掉那条待结清通知将要描述的收尾输出。

支持的连派方式是：等那条点名了自己派发的通知到达，再派下一条；目标上没有未结清看守时，派发照常受理。

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
- `src/tools-management.ts` — 走 `ctx.sessionController` 的创建/改名/分叉；共享的工作区解析器处理「显式 workspaceId / 继承调用方工作区」与已删除 `cwd` 的显性拒绝。
- `src/tools-dispatch.ts` — 走 `resolveAgent` + 结算看守的 `session_dispatch`；`newSession` 复用同一个工作区解析器与 `cwd` 守卫。
- `src/watch.ts` — 结算看守：inbox 唤醒源、观察令牌与收尾输出选取。
- `src/notice.ts` — 两种消息 kind、结算通知与 `sendWaking` 投递。
- `src/tools-state.ts` — 走 `ctx.workspaceRegistry` 的归档/置顶动词。
- `src/types.ts` — 参数/返回值契约与结构化错误类型。

## 已知限制

- 看守不跨插件卸载：它由注册 effect 拥有，卸载即取消挂起的看守，且不补报。
- 没有等待上限。一个永不静止、也永不被销毁的目标会一直被看守到卸载；`maxConcurrentWatches` 限定这类看守能积累多少个。
- 看守会缓存目标会话在本次看守期间的事件。事件是共享的冻结值，所以这是一个引用数组而非拷贝，但一个跑得极久的目标仍会把它涨到结算为止。
- 看守是外部观察者：它会在收尾前复查会话 seq，但不能像官方 manager 关闭子级那样关闭目标的输入准入（`runMaintenance`）。本插件自己的第二次派发在看守待结清期间会被拒绝，但从任何其它路径进来的输入——人在 GUI 里打字、到期的提醒、别的插件——仍然会落进来，而且没有下一次看守兜底，于是这条收尾输出可能描述的是这次派发根本没要求的活。
- 带未结清看守的目标不能再接 `session_dispatch`。结合上一条：一个永不静止、也永不被销毁的目标会一直没法通过本工具派活，直到它的看守结清或插件卸载；本插件的其它工具与插件之外的路径都不受影响。
- 看守不会像官方 manager 在父级子树正在关闭时用 `parent.inject` 那样把通知停放下来；投不出去的通知记一条 warning 后被丢弃。
- 无法命名的下场与无法命名的 `turn/end` reason 都按 `error` 汇报、绝不报成功；该分支只能通过可扩展合并触达。

## 延伸阅读

- 宿主 Session 业务 API：`@deepseek-ai/dsh-api-session-controller`（`ctx.sessionController`）。
- 归档/置顶语义：`@deepseek-ai/dsh-workspace`（`ctx.workspaceRegistry`）。
- 工具契约：`@deepseek-ai/dsh-tools`（`defineTool`、`ctx.tools.register`）。
- 本看守所对照的结算观察者：`@deepseek-ai/dsh-subagent`（`src/manager.ts`、`src/continuation-messages.ts`）。
