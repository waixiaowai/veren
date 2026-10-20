# @veren/app-host-bundle

纯配置组合包：一步把 Veren 应用框架装进 DSH profile——三个宿主服务（`app-registry` / `page-registry` / `task-center`）加上把它们接成一处的 `app-host` 装配插件（应用 resolver、页面镜像面、真实 agent 作用域会话端口、focus 接缝）。安装后宿主里存在 `ctx.apps` / `ctx.pageRegistry` / `ctx.taskCenter`，应用插件不需要任何手工跨服务接线。

经插件管理器 / `dsh plugin add` 安装；组合包的 `cordis.patch.yml` 是这套技术栈唯一的 profile 层（成员插件都是普通依赖，不带自己的 bundle 声明）。

## 常用命令

```bash
pnpm build
pnpm test
```
