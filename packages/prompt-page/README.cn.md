# Prompt Page（页面运行时）

[English](./README.md) | 中文

## 是什么 / 何时用

`@veren/prompt-core` + `@veren/prompt-host-messages` 之上的 LLM 页面会话运行时——`react-dom/client` 的对应物。用它声明带唯一 URL 的页面、注册进 `PageRegistry`、把解析出的页面挂载为独立页面会话。静态面（系统提示词/工具/skills）归 DSH preset；本包只管 URL、动态上下文与生命周期钩子。

## 模型

- **一页 = 一会话**：独立 `MessageHost`（独立版本链/快照基线）；状态在共享的权威 store 里——关闭会话永不丢状态。
- **页面注册表**：页面注册 `{ name, url, description }`；url 模式仅路径段（`/task-detail/:taskId`）；`resolve(url)` 合并路径参数 + query（path 优先），返回规范化后的具体 URL。
- **导航 = resolve → mount**：关旧会话、`mountPage` 新会话；指针经 `session.pointerMessage`（`OPEN /task-detail/t-12 {...}`）作为新会话第一条 user 消息注入。
- **definePage fail loud**：空名称/空描述、非路径或重复 `:param` 的 url、非函数 tree。
- **生命周期钩子（预留）**：`onLoad(params)` 挂载后；`onComplete(params)` 供消费方决定是否归档会话（插件经 `workspaceRegistry.archiveSession` 关闭）。
- **可选策略装配**：给 `mountPage` 传 `assembly: { systemPrompt, provider?, policy?, budget? }`，会话即获得 `assemble()`——预算触顶 remount + 按 provider 规划缓存断点（来自 `@veren/prompt-host-messages`；未知 provider 显式默认 deepseek 语义，见该包 README）。不给 `assembly` 行为与历史完全一致。
- **实时绑定（`PageLiveBinding`）**：页面注册时可一并声明权威 store，封成 `{ mount(params, scope?): PageSession<never> }`——状态类型 `S` 在 store 所在处被消费，注册表与挂载点都从不接触它。`scope` 是该会话的 `agent.ctx`：组件页的 `ctx.page.effect` / `ctx.page.on` 经它注册（DSH 作用域模型），agent-subject 事件按该 agent 过滤、清理随会话作用域；没有作用域（agent 尚未创建的暂存预览）时回退到创建者 ctx / 视图 teardown。`ctx.page.tool(def)` 记录会话作用域工具，由页面运行时挂载；ctx 的固有成员（`ctx.effect` / `ctx.on` / `ctx.tools`）不被改写。两条路径都用 `mountPage` 挂载；store 变化全同步进 `MessageHost` 的版本链，正因如此宿主能在下一轮模型请求注入最新快照（§3.10.2/§3.10.3）。

## 组件页（`defineComponentPage`）

页面组件是模块级函数 `PageFC<P> = (props, ctx) => ElementInput`：`props` 是 URL 参数，`ctx` 是**真实的宿主 Context**（声明合并的服务面直接读）。页面自己的生命周期与工具登记在 `ctx.page` 上——ctx 固有的 `effect` / `on` / `tools` 不被改写：

- `ctx.page.effect(run)`：首帧执行一次；返回的清理登记到该会话的 `agent.ctx` 作用域（带作用域挂载时），agent 销毁时执行，视图提前退订时更早执行。
- `ctx.page.on(name, handler)`：首帧订阅一次；有作用域时经 `agent.ctx` 订阅，`scopeTarget` 只放行该 agent 的事件。
- `ctx.page.tool(definition)`：记录会话工具，页面运行时把它挂到该会话的 agent 作用域。

`defineComponentPage(component, meta, ctx?)` 返回 `{ page, live }`；页面运行时按会话调用 `live.mount(params, scope?)`。应用通常经 `ctx.apps.pages(id).register(component, meta)` 注册（内部走这个适配器）。

## 运行

```bash
pnpm --filter @veren/prompt-page test
```
