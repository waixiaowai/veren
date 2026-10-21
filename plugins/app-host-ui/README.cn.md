# @veren/app-host-ui

Veren 应用工具栏的 Web 半边。它在聊天输入工具栏（`conversation.input.left`）上加一个**应用下拉**：下拉列出宿主 `appHost` 网关里的全部已装应用；选中某个应用即打开它的**入口页面**（新建一条页面会话），并跟随宿主的 `app-host/focus` 事件把界面切到该会话。它是 focus 端口的 GUI 半边——headless、ACP、SDK profile 请跳过：那里 `app_list` / `app_open` 模型工具已覆盖全部操作。

## 何时使用

- profile 里已加载 `@veren/app-host` 装配（含 `@veren/app-host-bundle`），且人们需要从聊天界面进入应用页面（任务工作台、笔记本、论坛、管家）。
- profile 没有装配时跳过：下拉只会显示"目录读取失败"，别无他用。

## 工作方式

- **数据通道**：浏览器半边用 `createTypertRemoteInfo` 手工构造 Typert Remote contribution（镜像宿主 `appHost` 网关的 `appHost/catalog`、`appHost/open`），经 `ctx.remote.$mount` 挂载；宿主的 `app-host/focus` emit 事件经同一 Remote 载体到达。
- **focus**：收到 `app-host/focus` 后调用 `ctx.uiWorkspace.openSession(sessionId)`——执行真正的界面切换。宿主侧永远不碰 DOM。
- **失败状态全部显式**：目录读取失败（带稳定错误码 + 重试）、目录为空、入口页缺失、应用停用/异常、入口页打开失败，都渲染成可读的行/提示——绝不静默空白。
- 页面会话在打开时即激活 agent（宿主侧职责），因此页面会话会以实例标题（`发布任务`、`主题 #12`……）出现在会话列表里，可以像普通会话一样点进去。

## 结构

- `src/client/remote.ts` – 手工 Remote contribution + focus 事件再声明。
- `src/client/catalog.ts` – 目录 HostObservable（`loading/ready/failed`）。
- `src/client/picker.tsx` – 下拉组件（纯 props，不接触 `ctx`）。
- `src/client/index.tsx` – 挂载命名空间、注册 slot、执行切换。
- `scripts/bundle.mjs` – 产出 `dist/index.js`（Node 行）与 `lib/client.js`（浏览器模块）。

English documentation: [README.md](README.md).
