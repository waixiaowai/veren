# @veren/app-host-bundle

纯配置组合包：一步把 Veren 应用框架装进 DSH profile——三个宿主服务（`app-registry` / `page-registry` / `task-center`）加上把它们接成一处的 `app-host` 装配插件（应用 resolver、页面镜像面、真实 agent 作用域会话端口、focus 接缝）和 `@veren/app-host-ui` Web 伴生插件（输入工具栏的应用下拉）。安装后宿主里存在 `ctx.apps` / `ctx.pageRegistry` / `ctx.taskCenter`，应用插件不需要任何手工跨服务接线。

经插件管理器 / `dsh plugin add` 安装；组合包的 `cordis.patch.yml` 是这套技术栈唯一的 profile 层（成员插件都是普通依赖，不带自己的 bundle 声明）。

**框架行的独占所有权（G1 契约）**：本组合包是唯一允许插入 `app-registry`、`page-registry`、`task-center`、`app-host` 四行的组合包。应用组合包（如 `@veren/forum-bundle`）不得重插这些行；它们改为把本组合包声明为依赖，插件 reconciliation 会把本组合包自己装成一个 profile 层，因此无论同装多少个应用组合包，框架行都只有一份。仓库根部的 `scripts/check-bundle-patch-rows.mjs` 同时强制这两半。

## 常用命令

```bash
pnpm build
pnpm test
```
