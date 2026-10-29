# @veren/task-workbench

Veren **应用**的参考实现：在 `@veren/app-registry`、`@veren/page-registry` 与 `@veren/prompt-page` 之上注册 `task-workbench` 应用（id、入口页面、页面集合、页面工具集、任务通道）。把本包当作「怎样写一个 Veren 应用」的样板来抄，而不是当库用。

[English](./README.md)

## 注册了什么

| 部分 | 值 |
| --- | --- |
| 应用 id | `task-workbench`（工具前缀 `task_workbench`） |
| 入口页面 | `list` → `/apps/task-workbench/list` |
| 页面 | `/apps/task-workbench/list`、`/apps/task-workbench/task/:taskId`、`/apps/task-workbench/publish` |
| 工具 | 12 个（`task_workbench__*`）：`list_tasks`、`take_task`、`complete_task`、`abandon_task`、`publish_task`、`requeue_task`、`get_page_task`、`take_page_task`、`split_task`、`drive_begin`、`drive_end`、`open_task_page` |
| 同意门 | browse/drive 两模式：写工具需要本回合用户消息或点名任务的投递指令 + `drive_begin` 声明范围（稳定 code `consent/*`） |
| 任务通道 | `ctx.taskCenter`（声明的硬 inject，G13）；发布/拆分失败原样抛出（fail loud） |

页面不再绑定预设。每页声明 `instructions`（给模型的说明，不是系统提示词）与 `instanceTitle`（如 `/task/:id` 实例化为「任务 #1」）。三个页面都是**一次性渲染的模块级组件**：组件体在页面会话的真实 Agent 上执行恰好一次——经 `agent.ctx.tools.register` 登记本页工具（全名，随 agent fiber 生灭），直读权威 store（同步内存面），正文即打开时刻的 store 状态。此后页面不再渲染：变化以工具调用的结果进上下文，不经页面刷新。

工具矩阵跟随页面原型（§3.10.1）：带参的 `take_task`（任意 id）挂在列表页——浏览入口的接取职责；详情页挂的是 `take_page_task`——**无参数的页面作用域接取**，接的恰好是该页面实例绑定的那条任务（URL 里的 `taskId`，经 page-registry 实例索引解析），且当任务中心有记录以该页为目标时同时接取其 30 分钟租约。投递闭环由此闭合：被投递给详情页的任务能被该页自己的会话接走，而不是落成 `failed/task-not-taken`。

**三概念（v2，设计定稿见 `docs/task-workbench-modes-dispatch.cn.md`）**：

- **推进（browse/drive + 同意门）**——队列权威在任务中心（重启持久），列表页首屏是策略视图（可接取/已派发/被持有/已完成/已退回 + 等待时长 + 需确认标记），种子示例按幂等键懒播（不重播）。写工具统一过同意门：本回合有 `kind:'user'` 的人类消息或点名任务的投递指令（`task-center/notice` / TASK 块），且先 `drive_begin` 声明范围与理由；逐轮生效，未声明范围拒绝 `consent/scope-exceeded`。门是机制不是措辞：信号来自 `session/event` 的增量折叠（真机实证 `turn/start` 先于本回合 user 消息），台账随 agent 对象回收，未观察过的会话 fail-closed。
- **派发（target 来自注册表目录）**——`publish_task` 的 `target_app` 从 `ctx.apps.catalog()` 校验（active 应用、entry 页为落点、带 `:param` 的页拒绝）；`requeue_task` 把 failed/orphaned 退回 open 队列或改派到别的应用（先发新记录再撤旧载体）。目标应用用全局 `task_take`/`task_complete` 干活，完成态经任务中心记录回传列表页策略视图。
- **导航（带回执）**——`open_task_page` 走 `pageRegistry.openUrl` 正门（返回 `{sessionId,url,title}` 回执；taskId 传入即目标页接取并收 TASK 块；同 URL 自开由宿主守卫幂等返回）。列表页正文带跨应用目录行（来源 = 注册表，逐条入口 URL + 一句话用途）。

## 测试

```bash
pnpm --filter @veren/task-workbench test
pnpm --filter @veren/task-workbench typecheck
```

## 怎样写一个 Veren 应用

一个 Veren 应用就是按 `apply` 里五步走完的普通 DSH 插件：

1. **声明依赖（G13）** —— 服务依赖只走 `export const inject = ['apps', 'pageRegistry', 'taskCenter']` 这样的显式声明，兄弟服务的能力以参数显式传递。**禁止运行期探测**（`ctx.get('…')`、`?.` 能力探测、"缺席即降级"分支）：真实宿主的属性守卫按被访问 ctx 的属主归因，访问本身就抛，那条降级通道从未生效过。确实需要"框架缺席也能激活"的隔离，正确做法是 G2 的拆包，不是探测。
2. **注册应用** —— `ctx.apps.register({ id, name, description, entry, instructions?, toolPrefix? }, ctx)`。第二个参数传你自己的 fiber：插件卸载时整个应用（页面+工具）随之摘除。`entry` 是应用内页面**键**，不是 URL。
3. **备好工具** —— 工具本体一律用 `@deepseek-ai/dsh-tools` 的 `defineTool` 产出（DSH `ToolDefinition`：name/description/parameters/output/execute，参数用逐属性 schema，`required: true` 标必填）；本地名 ≤24 字符、应用内唯一，以全名 `<toolPrefix>__<本地名>` 备好、绑进页面模块槽位（本包的 `bindWorkbenchRuntime`）。应用级能力声明放应用定义的 `requires`。**应用工具目录已不存在**：工具由页面组件体在唯一一次渲染里自行登记。
4. **定义页面** —— 把每页写成模块级组件（`PageFC`）加它的 `ComponentPageMeta`（URL 必须是 `/apps/<appId>/...`），再 `ctx.apps.pages(id, ctx).register(component, meta)`。组件体在页面会话的真实 Agent 上执行恰好一次：经 `agent.ctx.tools.register` 登记本页工具、从装配期绑定的模块槽位取依赖、返回正文。异步首屏读同样是组件体自己的 lifecycle——`agent.ctx.effect` 发起取数、事实经 followup 消息送达。不要声明 `preset`；改声明 `instructions`、`instanceTitle`。**页面注册是单入口**：app-registry 会自动把页面镜像进 page-registry 的 URL 索引（`openUrl` 才能解析它）；应用作者不要再自己调 `ctx.pageRegistry.registerAppPage`（那是内部原语），镜像失败会回滚并抛错，不会出现"目录可见却打不开"的静默漂移。完整示例见本包 `src/pages.tsx`（`bindWorkbenchRuntime` 槽位 + 组件体 `agent.ctx.tools.register`）与 `src/index.ts`（`pages.register(component, meta)`）。
5. **全有或全无的接线（G13 规则 3）** —— 定义 → 工具 → 页面收进**单个 `ctx.effect`**；体内任何一步失败都把已完成的步骤逆序回滚再抛出，绝不留下"应用在、工具缺页"的半接线状态（见 `tests/app.spec.ts` 的回滚用例）。

任务结构（§4.7）：任务条目带 `parentId`（创建时写一次、不可变——本地 store 同样如此，环因此结构上不可能）；整棵子树的进度是派生的 `2/5` 徽标（全树终态/全树节点），不落 store。详情页渲染子任务树区——活跃分支默认展开、终态分支折叠成进度徽标——`instanceTitle` 始终是根任务标题；子任务没有自己的 URL 和会话。`split_task` 把已接取节点拆成一条 open 子任务（仅当前接取者可用；安全上限深度 ≤ 8 / 单节点 32 子 / 单树 200 节点，超限返回 `task/subtree-limit`）；发布不支持带子任务的嵌套模板（§4.7.6）。

让它成为「应用」而不是「插件」的规则：id 与工具前缀全宿主唯一、校验 fail loud；页面统一收在 `/apps/<appId>/` 命名空间下；生命周期绑定你的 fiber（用 `ctx.effect` 按可逆序登记清理）；永远不碰用户自选的预设。

设计依据见 `docs/application-concept.cn.md`（§2–§4、§7.1、§8.1）与 `docs/task-workbench-modes-dispatch.cn.md`（v2 三概念：状态迁移表 + §3.10.1 矩阵扩展表）。
