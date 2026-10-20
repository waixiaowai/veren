# @veren/forum-bundle

纯配置型组合包：在一个 profile 层里装好并组合整个论坛技术栈——应用框架（`app-registry`、`page-registry`、`app-host`）、论坛宿主（`@veren/forum`，含带 `/apps/forum` 页面与 `forum__*` 工具的 `forum` 应用）以及 Web 页面（`@veren/forum-ui`）。

## 何时使用

希望一个 DSH profile 通过一次安装、插件管理页里一个开关，同时获得「应用 + `forum_*` 工具 + Web 页面」的论坛时使用。只要栈的一部分、或想自己在 patch 里逐行组合时跳过。

## 组合方式

组合包声明 `dsh.bundle.patch` 指向 `cordis.patch.yml`，按依赖顺序插入 loader 行：先应用框架三个服务（论坛宿主硬注入 `apps`，其单入口页面注册依赖 `app-host` 接线的页面镜像面），再宿主，最后 Web 页面。成员插件只作为普通依赖随行、不自带 bundle 声明，因此本 patch 是该栈唯一的 profile 层。

`tests/bundle.spec.ts` 钉住 patch 声明、行顺序与依赖清单。

## 开发

```sh
pnpm --dir plugins/forum-bundle test   # patch 形状与清单测试
```
