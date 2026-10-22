# @veren/app-host

Use when a DSH profile needs the Veren application framework wired in one place: this host-assembly plugin binds the app registry, page registry, and task center together (app resolver, page mirror, real agent-scoped session port, focus seam) so that installing an app plugin requires no manual cross-service wiring; skip it only when you compose the three services by hand in tests.

# @veren/app-host（中文）

宿主装配层：把 `ctx.apps` / `ctx.pageRegistry` / `ctx.taskCenter` 的全部接缝在一处显式接上（应用 resolver、页面镜像面、真实 agent 作用域会话端口、focus 接缝）。装一个新应用插件 = 它自己 `ctx.apps.register/pages/tools`，此外零接线。Loader 行顺序：三个服务在先、本插件在后（`inject` 已声明）。README 细节见仓库 docs/application-concept.cn.md §8.2。

**G13 显式接线**：三步装配收进单个 `ctx.effect('app-host:wire')`，任一步失败即逆序回滚已执行步骤再重抛——系统要么三步全接上，要么什么也没接，绝无半接线（测试：`tests/assembly.spec.ts` "全成或全回滚" 用例）。`pageRegistry.bindPorts` 的全部端口（sessions/apps/toolsOf/tasks/deliveries/releaseLeases/pageData）由本插件以**纯参数**穿过公开接口传入——page-registry 不再自己摸兄弟服务（真机守卫按属主归因，探测通道不存在）。`sessions` / `agents` 走本插件声明过的 inject + declaration merging 真实面（`ctx.sessions` / `ctx.agents`），无 `ctx.get` 探测、无降级分支。

## Live page views (PAGE-DATA sync) / 活的页面视图

A page registered with an authoritative store (`ctx.apps.pages(id).register(page, { store })`) becomes a live view: this assembly mounts a store-subscribed view per page session, and every store change reaches the next model request as a `PAGE-DATA` block appended at `agent/pre-step` — after the claimed messages, so a `page_send` followup always precedes it. Injection is version-gated (no change → nothing appended), carries a full snapshot per change ("the latest block wins", per §3.10.2), and is bounded: `Config.pageDataMaxItems` / `pageDataMaxBytes` (defaults 50 / 4096) cap each collection and each block; over-limit data is dropped at section granularity and marked `truncated`. The hub (`createPageDataSync`) drops a view when its session is deprecated, rolled back, or its agent is disposed. Tests: `tests/page-data.spec.ts` (a store mutation really appears in the next request, ordering, per-session isolation, truncation) and the backfill case in `tests/assembly.spec.ts`.

注册时声明权威 store 的页面（`ctx.apps.pages(id).register(page, { store })`）就是活的视图：本装配为每个页面会话挂载一份订阅 store 的视图，store 的每次变化都以 `PAGE-DATA` 块追加在 `agent/pre-step` 里进入下一轮模型请求——追加在已认领消息之后，所以 `page_send` 的投递文本永远在前。注入受版本门控（无变化零注入）、每次携带全量快照（"以最新一次为准"，§3.10.2），且有界：`Config.pageDataMaxItems` / `pageDataMaxBytes`（缺省 50 条 / 4096 字节）分别限制每个集合与每个块，超限数据按区整块丢弃并标注 `truncated`。枢纽（`createPageDataSync`）在会话废弃、回滚或 agent 销毁时解绑视图。测试：`tests/page-data.spec.ts`（store 变化真的出现在下一轮请求里、顺序、多会话隔离、截断）与 `tests/assembly.spec.ts` 的回填用例。

## Staged picks / 暂存的选中（选中应用 ≠ 开始会话）

`appHost/stage` pre-mounts the page's tool face on the current session (`pageRegistry.mountPreview` — one render to collect catalog + dynamic tools; no page instance, no index row, no PAGE block) and records the intent. The first user message promotes the session in `agent/pre-step`: the instance lands in the index, the PAGE block enters that step's decision, and the same tool definitions are re-mounted. Pre-mounting is what puts the final face into step 1's request — the harness collects tools before `agent/pre-step` runs, so a tool mounted there only takes effect on the next step (live evidence: step 1 ran the old face, step 2 reported "tools updated"). `appHost/unstage` releases the face; a failed promotion releases it too.

`appHost/stage` 把该页面的工具面预挂到当前会话（`pageRegistry.mountPreview`——渲染一次收集目录 + 动态工具；不建页面实例、不写索引、不追加 PAGE 块）并登记意图。首条用户消息在 `agent/pre-step` 里提升：实例落索引、PAGE 块进入本轮决策、同一套工具定义重挂。预挂是第一步请求头拿到最终工具面的原因——宿主在 `agent/pre-step` 之前就收齐了工具，在那里面挂只能下一步生效（真机证据：第一步旧面、第二步"工具已更新"）。`appHost/unstage` 释放这层面；提升失败同样释放。

Page components' `ctx.page.effect` / `ctx.page.on` register on that session's `agent.ctx` (the DSH scope model): `scopeTarget` admits only that agent's events, and cleanup follows the agent scope; an earlier view teardown (preview/deprecation) disposes it first. `ctx.page.tool` records session tools the runtime mounts on the same scope; the ctx's inherent `effect`/`on`/`tools` are never rewritten. The session port's `scopeOf` provides that scope to `live.mount`. Without an agent (an agentless preview) the view falls back to the creator context.

页面的 `ctx.page.effect` / `ctx.page.on` 注册在该会话的 `agent.ctx` 上（DSH 作用域模型）：`scopeTarget` 只放行该 agent 的事件，清理随作用域；视图提前退订（预览/废弃）时先由视图断开。`ctx.page.tool` 记录会话工具，由运行时挂到同一作用域；ctx 固有的 `effect`/`on`/`tools` 不被改写。会话端口的 `scopeOf` 把这个作用域交给 `live.mount`。agent 尚未创建时（暂存预览）视图回退到创建者 ctx。
