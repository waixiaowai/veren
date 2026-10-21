# @veren/forum-bundle

纯配置型组合包：一次装好并组合整个论坛技术栈——论坛宿主（`@veren/forum`，含带 `/apps/forum` 页面与 `forum__*` 工具的 `forum` 应用）以及 Web 页面（`@veren/forum-ui`）。

## 何时使用

希望一个 DSH profile 通过一次安装、插件管理页里一个开关，同时获得「应用 + `forum_*` 工具 + Web 页面」的论坛时使用。只要栈的一部分、或想自己在 patch 里逐行组合时跳过。

## 组合方式

组合包声明 `dsh.bundle.patch` 指向 `cordis.patch.yml`：先插 Host 行（拥有存储域、`forum` 远端命名空间、面向模型的工具与通知投递），再插 Web 页面。它**不插任何应用框架行**：`app-registry`、`page-registry`、`task-center`、`app-host` 由 `@veren/app-host-bundle` 独占插行，而本组合包把它声明为依赖。dsh plugin 的 reconciliation 会把每个声明了 `dsh.bundle.patch` 的已装依赖自己变成一个 profile 层，所以装论坛组合包会连带装上框架，且无论同装多少个应用组合包，`app-host` 行都只被插入一次（G1 去重契约）。

如果框架层缺失（例如有人删掉了这个依赖），Host 行不会静默降级：它硬注入 `apps`，会保持 pending，在插件页显示为未启用，并在启动日志里留下告警。

成员插件只作为普通依赖随行、不自带 bundle 声明。`tests/bundle.spec.ts` 钉住 patch 声明、行顺序、「无框架行」与依赖清单。

## 开发

```sh
pnpm --dir plugins/forum-bundle test   # patch 形状与清单测试
```
