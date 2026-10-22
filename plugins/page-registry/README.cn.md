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
- `service.mountPreview(sessionId, url)` / `releasePreview(sessionId)`：暂存选中的应用面——渲染一次页面（含首屏 load），收集目录 + 动态工具并挂到该会话的 agent 作用域，**不**建实例、不写索引、不追加 PAGE 块。之后的 `openUrl(url, { reuseSessionId })` 用同一套定义重挂（两条路径共用一个收集器），模型第一步就是最终工具面；在 `agent/pre-step` 里挂工具会错过该步的工具收集。`releasePreview` 在撤销选择或提升失败时摘下这层面。
- 宿主工具 `app_open` 的本体由 `createAppOpenTool(port)` 构造；注册由宿主装配层（app-host）在它唯一的"全成或全回滚"接线 effect 里 `ctx.tools.register` 完成（G13）——本模块不再自带 effect。

## 按 URL 幂等投递（`page_send`，§3.9）

- `service.deliverUrl(url, { message, wake?, callerSessionId? })`：幂等投递——该 URL 有活会话则直接 append，没有则新建（走 `openUrl` 创建路径，但**不发 GUI focus**：投递不是导航）。返回 `{ sessionId, url, created, redirected }`。
- 级联闸门：链深台账把任意投递链封顶在 `MAX_DELIVERY_HOPS`（4）；超限以 `page/hop-limit` 拒绝——构造上一处闸门，不靠调用方自觉。
- 废弃竞态：投递后重查索引；指针已易主（人重开了该 URL）则把消息补投给当前活会话（≤ `MAX_DELIVERY_ATTEMPTS` = 3 次），结果如实带 `redirected: true`。
- 唤醒策略：缺省唤醒目标（一个模型回合）；`wake: false` 只落会话日志，等下次唤醒一并消费。
- 宿主工具 `page_send` 本体由 `createPageSendTool(port)` 构造、由宿主装配层注册；页面 agent 也拿得到（不在页面会话屏蔽名单里）。

## 显式接线（G13）

本服务从不在运行期探测兄弟服务（没有对 `apps` / `taskCenter` / `sessions` / `agents` 的 `ctx.get(...)`——真机属性守卫按被访问 ctx 的属主归因，探测通道不存在）。声明的 inject 只有 `['storageDomain']`。全部运行期能力经 `bindPorts(ports, index?)` 以**纯参数**传入（整体替换，无部分合并）：

- 必填：`sessions`（页面会话端口）、`apps`（应用注册表 `get`）、`toolsOf`（应用工具目录）；
- 可选能力：`tasks`（任务接取）、`deliveries`（收件箱投递）、`releaseLeases`（废弃时租约释放）、`scopeOf`（该会话的 `agent.ctx`，交给 `live.mount`，让页面组件的 `effect`/`on` 注册在 agent 作用域上——事件按 agent 过滤、清理随作用域；agent 未创建的暂存预览缺席，回退到创建者 ctx）。

宿主装配层（`@veren/app-host`）执行 `bindPorts` 之前，`openUrl` / `releaseApp` 以 `page/host-unavailable` fail loud——绝不假成功。

## 活的视图（`pageData` 端口，§3.10.3）

- `registerAppPage(appId, page, live?)` 接受 `PageLiveBinding`（由 app-registry 从应用声明的 store 封出）：`live.mount(params)` 返回该会话订阅 store 的视图。
- `openUrl` 在 `index.commit` **之前**经可选 `pageData` 端口绑定该视图——挂载失败走既有的两阶段回滚，不会留下"会话活着、视图死着"的半状态。初始游标取 PAGE 块已覆盖的版本，首帧/快照内容不会被当成 PAGE-PATCH 再发一遍。同 URL 重开的旧会话废弃与回滚路径都调用 `pageData.unbind(sessionId)`。
- 没有 `pageData` 端口或没有 `live` 绑定时页面保持静态，其余行为不变。渲染、截断与上下文投递归绑定方（`@veren/app-host` 的 `createPageDataSync`）。
