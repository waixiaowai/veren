# dsh-session-dispatch（会话派发插件）

[English](README.md) | 中文

## 摘要

一个 Host-only 的 DeepSeek Harness bundle，注册一个模型可调用的工具 `session_dispatch`：把一段提示交给另一个会话后立即返回；当那个会话真正静止时，看守把它的收尾 assistant 输出作为 follow-up 消息投回调用方会话并唤醒它。

适用场景：一个会话需要把长活派给另一个会话，又不愿阻塞自己。`person-agent-tool-session` 的 `session_prompt` 在 `wait: true` 时会阻塞调用方直到目标空闲——本部署实测阻塞过 16 分钟。调用方必须在同一次工具调用里读到结果时，不要用本包。

## 目录

- [它注册什么](#它注册什么)
- [结算模型](#结算模型)
- [配置](#配置)
- [构建与测试](#构建与测试)
- [装进 profile](#装进-profile)
- [验证与卸载](#验证与卸载)
- [已知限制](#已知限制)

## 它注册什么

| 导出 | 值 |
|---|---|
| `name` | `sessionDispatch` |
| `inject` | `['tools', 'agents', 'sessions', 'sessionController']` |
| `Config` | `@deepseek-ai/schemastery` schema；Loader 在 `apply` 之前校验该行的 `config` |
| `apply` | 先注册看守取消器，再注册工具。两者都是 `ctx.effect` 贡献，卸载时逆序清理，不泄漏。 |

`session_dispatch` 的参数：

| 参数 | 类型 | 含义 |
|---|---|---|
| `prompt` | string，必填 | 作为目标会话自己的一个 follow-up turn 投递；去空白后必须非空。 |
| `sessionId` | string | 已有目标会话 id。与 `newSession` 二选一。 |
| `newSession` | object | `{ cwd?, agentPreset? }`；经 `ctx.sessionController.create` 新建目标。 |
| `report` | boolean，默认 `true` | `true` 把目标收尾输出投回调用方；`false` 为纯派发。 |

规范返回值就是「已接受的派发收据」，不含任何等待结果：`{ sessionId, messageId, watchId, reporting }`。失败抛带稳定 `code` 的 `SessionDispatchError`，与相邻的会话工具一致：`SESSION_DISPATCH_PROMPT_EMPTY`、`SESSION_DISPATCH_TARGET_MISSING`、`SESSION_DISPATCH_TARGET_CONFLICT`、`SESSION_DISPATCH_TARGET_UNRESOLVED`、`SESSION_DISPATCH_CREATE_FAILED`、`SESSION_DISPATCH_CAPACITY_REACHED`、`SESSION_DISPATCH_NO_CALLER`。

## 结算模型

看守照抄官方子 agent 的结算观察者——`packages/subagent/subagent/src/manager.ts` 里的 `watchLocalSettlement()` / `settlementState()` / `wake()`。那段代码已经把本插件绝不能混为一谈的两件事分开了：

- **同步通知。** `agent/inbox/inserted`、`agent/inbox/claimed`、`agent/inbox/discarded` 是 `emit` 事件，唯一职责是唤醒观察者：`wake()` 结清当前观察令牌并换一个新的。
- **异步静止。** 观察者是一个常驻协程，自己 `await agent.whenIdle()`，然后读令牌判断：
  - `retry` —— 等待期间令牌被换过，说明状态变过，重新评估；
  - `wait` —— 还有输入没跑，停在「下一次唤醒」上，不空转；
  - `ready` —— 真正静止，收尾并回报。

由此有三条刻意的决定：

1. **完全不订阅 `agent/status`。** `whenIdle()` 才是权威静止信号：maintenance 任务运行期间公开状态仍是 `idle`，所以 `status === 'idle'` 不等于 `whenIdle()` 已 resolve。根本不存在会写错的状态监听。
2. **没有定时器，也没有轮询。** 不排任何任务；观察者要么等在 `whenIdle()` 上，要么等唤醒事件，等待期间不消耗 CPU。
3. **没有 `sessionId` 比对，也没有全局监听。** 唤醒源登记在目标 Agent 自己的上下文上（`agent.ctx.on(...)`），由 `@deepseek-ai/dsh-scope` 按作用域路由，因此收到的只会是这个 Agent 的通知；Agent 卸载时监听一并摘除。

挂起是一个同步块，顺序固定：登记唤醒源 → 投递 → 启动观察者。投递夹在登记与观察之间，中间没有 `await`，所以目标之后的每一次 inbox 变化都会被记进令牌，观察者既不会漏掉转换，也不会提前宣布完成。回报只读投递之后新产生的派生历史，因此目标会话里原有的输出不会被误当成这次派发的结果。

回报用 `agent.followup()` 投给存活的调用方 Agent，再 `ctx.sessions.flush()` 确认持久化。调用方 Agent 已不在注册表时（例如宿主重启过），回退到 `ctx.sessionController.resolveAgent()` 恢复它——这正是 `@deepseek-ai/dsh-schedule` 走的路。回报的消息来源 kind 是 `session-dispatch`，在 `src/types.ts` 里经 `MessageSourceMap` 声明。

## 配置

每个可调项都是经过校验的 `Config` 字段，可在 profile patch 里按行 id（`session-dispatch`）覆盖。按 id 覆盖时 `config` 是整体替换，所以要重述每个想保留的字段。

| 字段 | 默认 | 含义 |
|---|---|---|
| `reportTemplate` | 见 `cordis.patch.yml` | 回报正文模板。必须保留 `{target_session_id}` 与 `{output}`，否则加载期 pattern 校验直接拒绝该行。占位符：`{target_session_id}`、`{watch_id}`、`{outcome}`、`{waited_ms}`、`{output}`。 |
| `emptyOutputText` | `(the dispatched session produced no assistant text)` | 目标没有 assistant 文本时替换 `{output}` 的正文。 |
| `maxReportChars` | `4000` | `{output}` 的字符上限，超出截断并追加省略号。 |
| `maxConcurrentWatches` | `64` | 同时挂起的看守上限；再要回报的派发以 `SESSION_DISPATCH_CAPACITY_REACHED` 被拒绝。 |

没有静默窗，也没有等待上限。早先的一版两者都有；它们是定时器，而结算判定并不需要。一次看守只会因为三种原因结束：结算、被看护的 Agent 离开注册表（`target-gone`）、插件卸载——这也正是 `maxConcurrentWatches` 存在的原因。

## 构建与测试

```powershell
cd C:\Users\imeep\Documents\cursour\session-dispatch-plugin
node link-deps.mjs                 # 一次性：把 @deepseek-ai/* 链进本包
node ..\node_modules\typescript\bin\tsc          # 构建 -> dist/
node ..\node_modules\vitest\bin\vitest.js run    # 测试
```

`link-deps.mjs` 存在的原因：本包不在 veren 工作区的 packages|plugins 通配里，pnpm 不会为它建 `node_modules`。Node 与 TypeScript 都按真实路径解析，缺了它本包会拿到 `cursour/node_modules/@deepseek-ai/*` 的提升副本，而 `@deepseek-ai/dsh-api-session-controller` 的声明解析到 `.pnpm` 存储里的另一份 `@deepseek-ai/cordis`。两份 cordis 实例意味着 `declare module '@deepseek-ai/cordis'` 的 Context 合并落到另一个模块上，`ctx.sessionController` 就不存在了。脚本幂等，可重复执行。

测试在 `tests/` 下，用 vitest。`tests/support.ts` 把真实插件装进真实 cordis `Context`（`ctx.plugin({ name, inject, apply }, config)`），走真实 `inject` 解析与真实 effect 逆序清理，只有外部服务是假的。`agent.ctx` 是 `createScope` 铸出的真实作用域，状态与 inbox 通知都经运行时的 `emitAgentEvent` 派发，所以作用域路由是被真实执行的，而不是模拟的。

## 装进 profile

安装只写 profile 目录，绝不写 DSH checkout，也绝不写 `~/.dsh`。

```powershell
node "C:\Users\imeep\Documents\cursour\session-dispatch-plugin\install-into-profile.mjs" `
  "C:\Users\imeep\.dsh_test_2\profiles\web"
```

脚本会备份 `package.json`、写入 `dependencies["dsh-session-dispatch"] = "link:<本目录>"`、把 `dsh-session-dispatch` 追加进 `dsh.profile.bundles`，并建一个 `node_modules` 目录联接。它拒绝写入 `~/.dsh`，缺构建产物时拒绝执行，可重复执行，并用 `rmdirSync` 拆联接（绝不递归删除）。装完**重启 Web GUI**；只有 bundle 层在启动时装配，本插件不含浏览器端模块。

手工等价步骤：在 profile 的 `package.json` 里加依赖项与 bundle 条目，然后

```powershell
New-Item -ItemType Junction `
  -Path "C:\Users\imeep\.dsh_test_2\profiles\web\node_modules\dsh-session-dispatch" `
  -Target "C:\Users\imeep\Documents\cursour\session-dispatch-plugin"
```

## 验证与卸载

1. 插件管理页：存在 id 为 `session-dispatch` 的行，`enabled` 为真，`fiberPhase` 不是 PENDING。PENDING 说明 `tools` / `agents` / `sessions` / `sessionController` 中有一个没就绪。
2. 能力侧：`session_dispatch({ sessionId: "<id>", prompt: "总结一下这个仓库" })` 立即返回收据，调用方不被阻塞；目标静止后调用方会话收到一条 `[SESSION DISPATCH REPORT]` 开头的 follow-up。
3. 纯派发：`report: false` 返回 `watchId: null`，之后不会有任何回报。

卸载：

```powershell
node "C:\Users\imeep\Documents\cursour\session-dispatch-plugin\install-into-profile.mjs" --revert `
  "C:\Users\imeep\.dsh_test_2\profiles\web"
```

然后重启 Web GUI。

## 已知限制

- 看守不跨宿主重启、也不跨插件卸载：`dispose()` 只取消、不补报。只有「必须跨重启的回报」才需要走 `ctx.schedule`，而它会持久化任务行，并拒绝被委派子 agent 拥有的会话。
- 没有等待上限，所以一个永不静止、也永不被销毁的目标会一直被看守到插件卸载。`maxConcurrentWatches` 限定这类看守能积累多少个。
- 调用方会话被委派子 agent 拥有且已经不存活时，`resolveAgent` 兜底会失败，回报写进 warning 后被丢弃。
- `newSession` 委托给 `ctx.sessionController.create`；preset 解析与工作区归属是那个服务的职责，这里没有覆盖。
- 回报是一段文本正文：投递之后新产生的最后一条非空 assistant 消息。它不拼装整轮、不附工具调用摘要，也不包含停放的输入。
