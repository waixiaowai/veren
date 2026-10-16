# @veren/startup-autostart-tool

独立宿主插件 `@veren/startup-autostart` 的可选模型工具插件。

## 适用场景

当 agent 需要创建、查看、修改、删除或立即运行启动项时安装此插件。它必须与 `@veren/startup-autostart` 宿主服务一起使用；如果只允许 UI 或 API 管理启动项，则无需安装工具插件。

## 工具

- `startup_create`
- `startup_list`
- `startup_update`
- `startup_delete`
- `startup_run`

工具通过 `ctx.startupAutostart` 调用宿主服务，不负责存储或启动触发。本包**不声明** `dsh.bundle.patch`，因此单独安装只会多一个依赖、**不会插入 Loader 行**：它经聚合包 `@veren/startup-autostart-bundle` 安装，由聚合包的 patch 把本行连同宿主行、UI 行一起插入。preset 可按需授权工具。发布时先发布新版宿主包，因为工具会引用宿主导出的公共校验常量。

## 开发

```sh
node scripts/gen-tsconfig-paths.mjs
node scripts/typecheck.mjs
node scripts/build.mjs
pnpm test
```
