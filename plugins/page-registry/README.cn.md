# Page Registry（页面注册表服务）

[English](./README.md) | 中文

## 是什么 / 何时用

宿主级 **Service 插件**，持有 LLM 页面会话的页面注册表——能力接缝中 `PageRegistryService` 契约的 Service Provider。页面插件需要把声明式页面（`{ name, url, description }`，URL 模式如 `/task-detail/:taskId`）注册进部署级唯一注册表、导航入口/目录/模型工具需要解析 URL（路径参数 + query，path 优先）时使用。没有声明式页面就不要装。

## 三个角色

- **Service Definition**（`src/service.ts`）：`register`（返回 disposer，HMR/卸载安全）、`resolve<S>(url)`、`get<S>(name)`、`catalog()`、`format(pattern, params)`
- **Service Provider**（默认导出）：部署顶层挂载一次；会话子作用域经 `inject: ['pageRegistry']` 解析到同一实例
- **Consumer**：页面插件（`registry.register(page)`）、导航工具（`registry.resolve(url)`）、目录面板（`registry.catalog()`）

## 契约

- 重名 / URL 模式冲突在注册时抛错（misconfiguration fails loud）
- `resolve` 无命中返回 `null`；合并参数为 `{ ...query, ...pathParams }`（path 优先）
- 内核（`@veren/prompt-page`）保持 cordis 无关；本插件是注册表与宿主相接的唯一位置

## 运行

```bash
pnpm --filter @veren/page-registry test
```

## 实例索引与页面运行时（第 1 阶段）

- `service.instances`：持久化 `PageInstanceIndex`（`app_pages` 存储域；reserve/commit 两阶段；重启后仍命中；会话被删自动失效重建）。
- `service.openUrl(url, { taskId })`：规范化 URL → 校验应用 → 一律新建页面会话（同 URL 旧会话先废弃）→ 挂 `<toolPrefix>__<本地名>` 工具 → 写一次 PAGE 块 → commit → 聚焦；任务场景先 take 再追加 TASK 块。稳定错误码：app/not-found、app/disabled、page/not-found、task/expired、page/session-create-failed、page/tool-conflict、page/index-unavailable、page/host-unavailable。
- `registerAppPage(appId, page)`：应用作用域注册（与 app-registry 的 `ctx.apps.pages(id)` 对接）；`page.<name>` 预设路径保持废弃。页面以 **pageKey（`<appId>/<本地名>`）** 为名登记——本地名跨应用必然重名，按裸名登记会让第二个应用在 duplicate-name 上失败。
- 宿主工具 `app_open` 的本体由 `createAppOpenTool(port)` 构造；注册由宿主装配层（app-host）在它唯一的"全成或全回滚"接线 effect 里 `ctx.tools.register` 完成（G13）——本模块不再自带 effect。

## 显式接线（G13）

本服务从不在运行期探测兄弟服务（没有对 `apps` / `taskCenter` / `sessions` / `agents` 的 `ctx.get(...)`——真机属性守卫按被访问 ctx 的属主归因，探测通道不存在）。声明的 inject 只有 `['storageDomain']`。全部运行期能力经 `bindPorts(ports, index?)` 以**纯参数**传入（整体替换，无部分合并）：

- 必填：`sessions`（页面会话端口）、`apps`（应用注册表 `get`）、`toolsOf`（应用工具目录）；
- 可选能力：`tasks`（任务接取）、`deliveries`（收件箱投递）、`releaseLeases`（废弃时租约释放）。

宿主装配层（`@veren/app-host`）执行 `bindPorts` 之前，`openUrl` / `releaseApp` 以 `page/host-unavailable` fail loud——绝不假成功。
