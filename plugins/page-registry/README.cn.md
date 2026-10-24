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
- `service.openUrl(url, { taskId })`：规范化 URL → 校验应用 → 一律新建页面会话（同 URL 旧会话先废弃）→ 页面组件体在唯一一次渲染里登记 `<toolPrefix>__<本地名>` 工具 → 写一次 PAGE 块 → commit → 聚焦；任务场景先 take 再追加 TASK 块。稳定错误码：app/not-found、app/disabled、page/not-found、task/expired、page/session-create-failed、page/tool-conflict、page/index-unavailable、page/host-unavailable。
- `registerAppPage(appId, page)`：应用作用域注册（与 app-registry 的 `ctx.apps.pages(id)` 对接）；`page.<name>` 预设路径保持废弃。页面以 **pageKey（`<appId>/<本地名>`）** 为名登记——本地名跨应用必然重名，按裸名登记会让第二个应用在 duplicate-name 上失败。
- `service.closePage(url)`：GUI 关闭路径（网关的 `appHost/unstage` 调它）——退役绑定该 URL 的页面会话：agent 被拆除（页面登记的一切随 fiber 逆序卸下），索引行翻废弃、URL 腾出。暂存/预览面已不存在：选中应用即立即打开页面会话。
- 宿主工具 `app_open` 的本体由 `createAppOpenTool(port)` 构造；注册由宿主装配层（app-host）在它唯一的"全成或全回滚"接线 effect 里 `ctx.tools.register` 完成（G13）——本模块不再自带 effect。

## 按 URL 幂等投递（`page_send`，§3.9）

- `service.deliverUrl(url, { message, wake?, callerSessionId? })`：幂等投递——该 URL 有活会话则直接 append，没有则新建（走 `openUrl` 创建路径，但**不发 GUI focus**：投递不是导航）。返回 `{ sessionId, url, created, redirected }`。
- 级联闸门：链深台账把任意投递链封顶在 `MAX_DELIVERY_HOPS`（4）；超限以 `page/hop-limit` 拒绝——构造上一处闸门，不靠调用方自觉。
- 废弃竞态：投递后重查索引；指针已易主（人重开了该 URL）则把消息补投给当前活会话（≤ `MAX_DELIVERY_ATTEMPTS` = 3 次），结果如实带 `redirected: true`。
- 唤醒策略：缺省唤醒目标（一个模型回合）；`wake: false` 只落会话日志，等下次唤醒一并消费。
- 宿主工具 `page_send` 本体由 `createPageSendTool(port)` 构造、由宿主装配层注册；页面 agent 也拿得到（不在页面会话屏蔽名单里）。

## 显式接线（G13）

本服务从不在运行期探测兄弟服务（没有对 `apps` / `taskCenter` / `sessions` / `agents` 的 `ctx.get(...)`——真机属性守卫按被访问 ctx 的属主归因，探测通道不存在）。声明的 inject 只有 `['storageDomain']`。全部运行期能力经 `bindPorts(ports, index?)` 以**纯参数**传入（整体替换，无部分合并）：

- 必填：`sessions`（页面会话端口）、`apps`（应用注册表 `get`）；
- 可选能力：`warn`（挂载期完备性告警——在真实登记差集收集完之后才发出；注册期只看得到静态声明）、`tasks`（任务接取）、`deliveries`（收件箱投递）、`releaseLeases`（废弃时租约释放）。

宿主装配层（`@veren/app-host`）执行 `bindPorts` 之前，`openUrl` / `releaseApp` 以 `page/host-unavailable` fail loud——绝不假成功。

## 实时绑定（组件页）

- `registerAppPage(appId, page, live)` **必填** `PageLiveBinding`；app-registry 的 `ctx.apps.pages(id).register(component, meta)` 经 `defineComponentPage` 推导出它——页面就是组件页，不存在没有实时绑定的页面。
- `live.mount(params, agent)` 就是一次性渲染：组件体在会话的真实 agent 上执行、在那里登记工具，返回值即 PAGE 块正文。挂载失败原样抛出，半成品会话被销毁。
- 本注册表没有 `pageData` 端口、也没有 PAGE-PATCH 同步：首屏读是组件体自己的 `agent.ctx.effect` lifecycle，此后的状态变化以工具调用的结果进上下文——绝不经页面刷新。
