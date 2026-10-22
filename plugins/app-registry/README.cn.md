# @veren/app-registry

## 这是什么

DSH 宿主级应用注册表插件：应用是用户可安装的产品单元（稳定 id、入口页面、工具前缀、能力、任务通道），由插件实现。当一个插件需要以"应用"的形态提供页面与任务时使用；纯能力插件不需要。

## 当前状态

第 1 阶段已实现。宿主服务 `ctx.apps`（`inject: ['apps']`）提供：`register(definition, ownerContext?) → 注销函数`、`get(id)`、`catalog()`，以及应用作用域注册面 `pages(id, caller?)` / `tools(id, caller?)` —— 两者都校验 fiber 归属（只有注册该应用的插件自己的上下文能拿到）。应用与注册它的插件 fiber 绑定：fiber 销毁即整应用（页面+工具）摘除，且幂等。工具对外名一律 `<toolPrefix>__<本地名>`；`toolPrefix` 缺省由 id 推导且全宿主唯一。工具定义直接复用 DSH 的 `ToolDefinition`（`@deepseek-ai/dsh-tools` 的 `defineTool` 产物）——应用目录不是第二套工具类型。能力等应用侧元数据走 `tools(id, caller?).define(tool, meta)` 的第二参；第 1 阶段只记录、不强制。宿主引导工具 `app_list` / `app_pages` 经 `createBootstrapTools(service)` 构造（`app_open` 归 page-registry 插件）。冻结契约在 `src/types.ts`，改动必须先报告。

## 常用命令

```bash
pnpm --filter @veren/app-registry typecheck
pnpm --filter @veren/app-registry test
```

## 活的页面

`pages(id, caller?).register(component, meta)` 注册组件页（`PageFC` + `ComponentPageMeta`）；在 `meta.store` 放权威 store（任意满足 `@veren/prompt-core` `ExternalStore<S>` 的对象，例如插件自己的、带 `getState` / `subscribe` 的类）即把页面标记为活的视图（§3.10.3）：适配器把 store 封成 `PageLiveBinding`（`live.mount(params, scope?)`）——页面运行时因此能挂载订阅 store 的视图，却从不接触 `S`，组件经 `useSnapshot()` 读 store。绑定随镜像进入 page-registry、也随 `listPageEntries(id)`（宿主装配的回填通道）传下去：先于装配注册的页面同样能变成活的。没有 store 的页面就只渲染静态正文。`register(page, { store })` 形态已不存在（随旧块管线一起删除）。

English docs: [README.md](./README.md)。
