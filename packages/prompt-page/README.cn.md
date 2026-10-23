# Prompt Page（页面运行时）

[English](./README.md) | 中文

## 是什么 / 何时用

`@veren/prompt-core` 之上的 LLM 页面会话运行时——`react-dom/client` 的对应物（原 `@veren/prompt-host-messages` 依赖已摘除，文档同步形状改由本包自有定义）。用它把页面写成组件、注册进 `PageRegistry`、把解析出的页面挂载为独立页面会话。静态面（系统提示词/工具/skills）归 DSH preset；本包只管 URL、组件渲染管线与页面生命周期钩子。

## 模型

- **一页 = 一会话**：独立 `MessageHost`（独立版本链/文档基线）；状态在共享的权威 store 里——关闭会话永不丢状态。
- **页面注册表**：页面注册 `{ name, url, description }`；url 模式仅路径段（`/task-detail/:taskId`）；`resolve(url)` 合并路径参数 + query（path 优先），返回规范化后的具体 URL。
- **导航 = resolve → mount**：关旧会话、挂新会话；指针经 `session.pointerMessage`（`OPEN /task-detail/t-12 {...}`）作为新会话第一条 user 消息注入。挂载原语是 `PageLiveBinding.mount(params, scope?)`，由页面运行时调用——不再有 `mountPage` 这类作者侧入口。
- **组件页是唯一路径**：旧块词汇（`Static`/`Data`/`Keyed`）、块宿主挂载与动态 preset 构建已整体删除。`definePage` / `defineAppPage` 保留为契约校验入口（URL 形态、§3.10.5 规则 3），与 `defineComponentPage` 共用。
- **生命周期钩子**：`meta.load(params, env)` 提供首屏数据，组件经 `useSnapshot()` 读取（失败态也是数据，正文里如实渲染）。没有 `onComplete` 钩子——它已随减法移除；关闭/归档会话是消费方的显式动作（插件经 `workspaceRegistry.archiveSession` 关闭）。
- **页面 hooks（`ctx.page`）**：组件页拿到**从会话 ctx 派生**的宿主 Context（`ctx.extend`——同一作用域的官方子上下文，固有成员的注册落在会话上、随会话回收；没有作用域——暂存预览——时从创建者 ctx 派生）加一个 `ctx.page` 面——`ctx.page.effect(run)` / `ctx.page.on(name, handler)` 登记到该会话的 `agent.ctx` 作用域（事件按 agent 过滤、清理随 agent 销毁；没有作用域时回退到创建者 ctx / 视图 teardown），`ctx.page.tool(def)` 记录会话作用域工具由页面运行时挂载。ctx 固有成员（`ctx.effect` / `ctx.on` / `ctx.tools`）不被改写。
- **实时绑定（`PageLiveBinding`）**：页面注册时可一并声明权威 store（`meta.store`），封成 `{ mount(params, scope?): PageSession<never> }`——状态类型 `S` 在 store 所在处被消费，注册表与挂载点都从不接触它。`defineComponentPage(component, meta, ctx?)` 返回 `{ page, live }`；store 变化全同步进 `MessageHost` 的版本链，并 diff 成增量 `PAGE-PATCH` 块进入下一轮模型请求（§3.10.2/§3.10.3）。

## 组件页（`defineComponentPage`）

页面组件是模块级函数 `PageFC<P> = (props, ctx) => ElementInput`：`props` 是 URL 参数，`ctx` 是**从会话 ctx 派生的宿主 Context**（声明合并的服务面直接读——与工具执行里 `exec.agent.ctx` 同一条解析链路）。页面自己的生命周期与工具登记在 `ctx.page` 上——ctx 固有的 `effect` / `on` / `tools` 不被改写：

- `ctx.page.effect(run)`：首帧执行一次；返回的清理登记到该会话的 `agent.ctx` 作用域（带作用域挂载时），agent 销毁时执行，视图提前退订时更早执行。
- `ctx.page.on(name, handler)`：首帧订阅一次；有作用域时经 `agent.ctx` 订阅，`scopeTarget` 只放行该 agent 的事件。
- `ctx.page.tool(definition)`：记录会话工具，页面运行时把它挂到该会话的 agent 作用域。

`defineComponentPage(component, meta, ctx?)` 返回 `{ page, live }`；页面运行时按会话调用 `live.mount(params, scope?)`。应用通常经 `ctx.apps.pages(id).register(component, meta)` 注册（内部走这个适配器）。

## 运行

```bash
pnpm --filter @veren/prompt-page test
```
