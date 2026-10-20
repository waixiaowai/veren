# @veren/app-host（中文）

宿主装配层：把 `ctx.apps` / `ctx.pageRegistry` / `ctx.taskCenter` 的全部接缝在一处显式接上——应用 resolver（发任务校验 + 卸载懒孤儿判定）、页面镜像面（页面注册单入口 + 卸载摘工具）、真实会话端口（页面工具挂**该会话 agent 作用域**，`agent/created`/`agent/disposed` 驱动挂载与释放；消息经 followup + flush 确认）、focus 接缝（接口已定，GUI 实现归工具栏下拉阶段）。装一个新应用插件 = 它自己 `ctx.apps.register/pages/tools`，此外零接线。Loader 行顺序：三个服务在先、本插件在后（`inject` 已声明）。设计见 docs/application-concept.cn.md §8.2。

# @veren/app-host

Host-assembly plugin: wires every seam between `ctx.apps` / `ctx.pageRegistry` / `ctx.taskCenter` in one place — the app resolver, the page mirror, the real session port (page tools mount into the owning session's agent scope, driven by `agent/created` / `agent/disposed`; messages go through followup + flush), and the focus seam (interface fixed; the GUI implementation lands with the toolbar app dropdown). Installing an app plugin means calling its own `ctx.apps.register/pages/tools` and nothing else. Loader row order: the three services first, this plugin last (`inject` declares the same). See docs/application-concept.cn.md §8.2.
