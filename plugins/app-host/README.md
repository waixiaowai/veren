# @veren/app-host

Use when a DSH profile needs the Veren application framework wired in one place: this host-assembly plugin binds the app registry, page registry, and task center together (app resolver, page mirror, real agent-scoped session port, focus seam) so that installing an app plugin requires no manual cross-service wiring; skip it only when you compose the three services by hand in tests.

# @veren/app-host（中文）

宿主装配层：把 `ctx.apps` / `ctx.pageRegistry` / `ctx.taskCenter` 的全部接缝在一处显式接上（应用 resolver、页面镜像面、真实 agent 作用域会话端口、focus 接缝）。装一个新应用插件 = 它自己 `ctx.apps.register/pages/tools`，此外零接线。Loader 行顺序：三个服务在先、本插件在后（`inject` 已声明）。README 细节见仓库 docs/application-concept.cn.md §8.2。

**G13 显式接线**：三步装配收进单个 `ctx.effect('app-host:wire')`，任一步失败即逆序回滚已执行步骤再重抛——系统要么三步全接上，要么什么也没接，绝无半接线（测试：`tests/assembly.spec.ts` "全成或全回滚" 用例）。`pageRegistry.bindPorts` 的全部端口（sessions/apps/warn/tasks/deliveries/releaseLeases）由本插件以**纯参数**穿过公开接口传入——page-registry 不再自己摸兄弟服务（真机守卫按属主归因，探测通道不存在）。`sessions` / `agents` 走本插件声明过的 inject + declaration merging 真实面（`ctx.sessions` / `ctx.agents`），无 `ctx.get` 探测、无降级分支。页面会话 agent 缺 skills 服务面时（preset realm 把 skills 隔离、属性访问落到空隔离域），`agentOf` 以属性探测为准，抛错即向 `agent.ctx.isolate('skills')` 挂一个真 `SkillRegistry` 兜底——会话私有、随 agent fiber 生灭，绝不遮蔽已提供该面的部署。

## One-shot pages (no PAGE-PATCH sync) / 一次性渲染的页面

A component page renders exactly once, on the page session's real Agent: the body registers its tools via `agent.ctx.tools.register`, starts its first-screen reads via `agent.ctx.effect` (facts ride followup messages into the context), and its return value is finalized into the PAGE block body. There is no store-subscription sync anymore — the render output is final (no diff, no PAGE-PATCH block); later changes reach the model as tool-call results, not page refreshes.

组件页在页面会话的真实 Agent 上恰好渲染一次：组件体经 `agent.ctx.tools.register` 登记工具、经 `agent.ctx.effect` 发起首屏读（事实以 followup 消息进上下文），返回值即刻定型为 PAGE 块正文。不再有 store 订阅同步——渲染产物即终态（无 diff、无 PAGE-PATCH 块）；此后变化以工具调用的结果进上下文，不经页面刷新。

## Picking an app opens the page right away / 选中应用即开页

`appHost/stage` opens the picked app's entry page immediately (one-shot render semantics): a fresh page session is created, its agent activates at `agent/created`, and the page body runs exactly once on that agent — the old "stage first, promote on the first message" intermediate state no longer exists. The gateway returns the new session's locator and the GUI switches to it; a missing entry page or a disabled app fails loud with a stable code. `appHost/unstage` closes the page instance bound to the session (`pageRegistry.closePage`): the agent is retired, everything the page registered unwinds with its fiber, the index row flips deprecated, and the url frees up.

`appHost/stage` **立即**打开所选应用的入口页（一次性渲染语义）：总是新建页面会话，agent 在 `agent/created` 当场激活，页面组件体在该 agent 上恰好执行一次——「先暂存、首条消息才提升」的中间态已不存在。网关返回新会话的定位信息，GUI 随即切换过去；入口页缺失/应用停用在这里带稳定 code fail loud（GUI 立刻看到原因）。`appHost/unstage` 关闭该会话绑定的页面实例（`pageRegistry.closePage`）：退役该会话的 agent——页面登记的一切随 fiber 逆序拆除，索引行翻废弃、URL 腾出。

The page body is a module-level `PageFC` receiving `(props, agent)` — the agent as-is, never wrapped: tools register via `agent.ctx.tools.register` (full names, living and dying with the agent fiber), effects/subscriptions/cleanups via `agent.ctx` directly. There is no agentless preview and no `ctx.page` hook face — every pick is a real session, and page logic never leaves the page.

页面组件体是模块级 `PageFC`，收到的 `(props, agent)` 里 agent 就是页面会话的真实 Agent（原样，不包装、不扩展）：工具经 `agent.ctx.tools.register` 登记（全名，随 agent fiber 生灭），effect/订阅/清理直接走 `agent.ctx`。不存在「无 agent 的暂存预览」，也没有 `ctx.page` 钩子面——每次选择都是真会话，页面逻辑绝不离开页面。
