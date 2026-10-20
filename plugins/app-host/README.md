# @veren/app-host

Use when a DSH profile needs the Veren application framework wired in one place: this host-assembly plugin binds the app registry, page registry, and task center together (app resolver, page mirror, real agent-scoped session port, focus seam) so that installing an app plugin requires no manual cross-service wiring; skip it only when you compose the three services by hand in tests.

# @veren/app-host（中文）

宿主装配层：把 `ctx.apps` / `ctx.pageRegistry` / `ctx.taskCenter` 的全部接缝在一处显式接上（应用 resolver、页面镜像面、真实 agent 作用域会话端口、focus 接缝）。装一个新应用插件 = 它自己 `ctx.apps.register/pages/tools`，此外零接线。Loader 行顺序：三个服务在先、本插件在后（`inject` 已声明）。README 细节见仓库 docs/application-concept.cn.md §8.2。

**G13 显式接线**：三步装配收进单个 `ctx.effect('app-host:wire')`，任一步失败即逆序回滚已执行步骤再重抛——系统要么三步全接上，要么什么也没接，绝无半接线（测试：`tests/assembly.spec.ts` "全成或全回滚" 用例）。`pageRegistry.bindPorts` 的全部端口（sessions/apps/toolsOf/tasks/deliveries/releaseLeases）由本插件以**纯参数**穿过公开接口传入——page-registry 不再自己摸兄弟服务（真机守卫按属主归因，探测通道不存在）。`sessions` / `agents` 走本插件声明过的 inject + declaration merging 真实面（`ctx.sessions` / `ctx.agents`），无 `ctx.get` 探测、无降级分支。
