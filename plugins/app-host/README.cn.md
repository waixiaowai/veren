# @veren/app-host（中文）

宿主装配层：把 `ctx.apps` / `ctx.pageRegistry` / `ctx.taskCenter` 的全部接缝在一处显式接上——应用 resolver（发任务校验 + 卸载懒孤儿判定）、页面镜像面（页面注册单入口 + 卸载摘工具）、真实会话端口（页面工具挂**该会话 agent 作用域**，`agent/created`/`agent/disposed` 驱动挂载与释放；消息经 followup + flush 确认）、focus 接缝（真实现：页面会话打开即激活 agent、按 instanceTitle 落标题，focus 发 `app-host/focus` 事件，由 `@veren/app-host-ui` 伴生插件完成界面切换），以及 `appHost` 网关（Web 伴生读应用目录/开入口页的 Remote 面）。页面会话在自己的 agent 作用域内屏蔽 `app_open` / `app_list` / `app_pages` 引导工具，避免页面 agent 重开本页造成会话级联。装一个新应用插件 = 它自己 `ctx.apps.register/pages/tools`，此外零接线。Loader 行顺序：三个服务在先、本插件在后（`inject` 已声明）。设计见 docs/application-concept.cn.md §8.2。

# @veren/app-host

Host-assembly plugin: wires every seam between `ctx.apps` / `ctx.pageRegistry` / `ctx.taskCenter` in one place — the app resolver, the page mirror, the real session port (page tools mount into the owning session's agent scope; messages go through followup + flush), and the focus seam (the real implementation emits the `app-host/focus` event, and the companion plugin `@veren/app-host-ui` performs the actual interface switch). Installing an app plugin means calling its own `ctx.apps.register/pages/tools` and nothing else. Loader row order: the three services first, this plugin last (`inject` declares the same). See docs/application-concept.cn.md §8.2.

## 一次性渲染的页面（无 PAGE-PATCH 同步）/ One-shot pages

组件页在页面会话的真实 Agent 上恰好渲染一次：组件体经 `agent.ctx.tools.register` 登记工具、经 `agent.ctx.effect` 发起首屏读（事实以 followup 消息进上下文），返回值即刻定型为 PAGE 块正文。不再有 store 订阅同步——渲染产物即终态（无 diff、无 PAGE-PATCH 块）；此后变化以工具调用的结果进上下文，不经页面刷新。装配级 `Config` 只剩 `enabled`（是否执行装配）。

A component page renders exactly once, on the page session's real Agent: the body registers its tools via `agent.ctx.tools.register`, starts its first-screen reads via `agent.ctx.effect` (facts ride followup messages into the context), and its return value is finalized into the PAGE block body. There is no store-subscription sync anymore — the render output is final (no diff, no PAGE-PATCH block); later changes reach the model as tool-call results, not page refreshes. The assembly-level `Config` is only `enabled` (whether to run the assembly).

## 选中应用即开页 / Picking an app opens the page right away

`appHost/stage` **立即**打开所选应用的入口页（一次性渲染语义）：总是新建页面会话，agent 在 `agent/created` 当场激活，页面组件体在该 agent 上恰好执行一次——「先暂存、首条消息才提升」的中间态已不存在。网关返回新会话的定位信息，GUI 随即切换过去；入口页缺失/应用停用在这里带稳定 code fail loud（GUI 立刻看到原因）。`appHost/unstage` 关闭该会话绑定的页面实例（`pageRegistry.closePage`）：退役该会话的 agent——页面登记的一切随 fiber 逆序拆除，索引行翻废弃、URL 腾出。

`appHost/stage` opens the picked app's entry page immediately (one-shot render semantics): a fresh page session is created, its agent activates at `agent/created`, and the page body runs exactly once on that agent — the old "stage first, promote on the first message" intermediate state no longer exists. The gateway returns the new session's locator and the GUI switches to it; a missing entry page or a disabled app fails loud with a stable code. `appHost/unstage` closes the page instance bound to the session (`pageRegistry.closePage`): the agent is retired, everything the page registered unwinds with its fiber, the index row flips deprecated, and the url frees up.

页面组件体是模块级 `PageFC`，收到的 `(props, agent)` 里 agent 就是页面会话的真实 Agent（原样，不包装、不扩展）：工具经 `agent.ctx.tools.register` 登记（全名，随 agent fiber 生灭），effect/订阅/清理直接走 `agent.ctx`。不存在「无 agent 的暂存预览」，也没有 `ctx.page` 钩子面——每次选择都是真会话，页面逻辑绝不离开页面。

The page body is a module-level `PageFC` receiving `(props, agent)` — the agent as-is, never wrapped: tools register via `agent.ctx.tools.register` (full names, living and dying with the agent fiber), effects/subscriptions/cleanups via `agent.ctx` directly. There is no agentless preview and no `ctx.page` hook face — every pick is a real session, and page logic never leaves the page.
