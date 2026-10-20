# @veren/app-host

Use when a DSH profile needs the Veren application framework wired in one place: this host-assembly plugin binds the app registry, page registry, and task center together (app resolver, page mirror, real agent-scoped session port, focus seam) so that installing an app plugin requires no manual cross-service wiring; skip it only when you compose the three services by hand in tests.

# @veren/app-host（中文）

宿主装配层：把 `ctx.apps` / `ctx.pageRegistry` / `ctx.taskCenter` 的全部接缝在一处显式接上（应用 resolver、页面镜像面、真实 agent 作用域会话端口、focus 接缝）。装一个新应用插件 = 它自己 `ctx.apps.register/pages/tools`，此外零接线。Loader 行顺序：三个服务在先、本插件在后（`inject` 已声明）。README 细节见仓库 docs/application-concept.cn.md §8.2。
