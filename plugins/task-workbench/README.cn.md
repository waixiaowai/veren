# @veren/task-workbench

Veren **应用**的参考实现：在 `@veren/app-registry`、`@veren/page-registry` 与 `@veren/prompt-page` 之上注册 `task-workbench` 应用（id、入口页面、页面集合、工具目录、任务通道）。把本包当作「怎样写一个 Veren 应用」的样板来抄，而不是当库用。

[English](./README.md)

## 注册了什么

| 部分 | 值 |
| --- | --- |
| 应用 id | `task-workbench`（工具前缀 `task_workbench`） |
| 入口页面 | `list` → `/apps/task-workbench/list` |
| 页面 | `/apps/task-workbench/list`、`/apps/task-workbench/task/:taskId`、`/apps/task-workbench/publish` |
| 工具 | `task_workbench__take_task`、`__complete_task`、`__abandon_task`、`__publish_task`、`__split_task` |
| 任务通道 | `ctx.taskCenter`（声明的硬 inject，G13）；发布/拆分失败原样抛出（fail loud） |

页面不再绑定预设。每页声明 `tools`（应用内本地名）、`instructions`（给模型的说明，不是系统提示词）与 `instanceTitle`（如 `/task/:id` 实例化为「任务 #1」）。

## 测试

```bash
pnpm --filter @veren/task-workbench test
pnpm --filter @veren/task-workbench typecheck
```

## 怎样写一个 Veren 应用

一个 Veren 应用就是按 `apply` 里四步走完的普通 DSH 插件：

1. **声明依赖（G13）** —— 服务依赖只走 `export const inject = ['apps', 'pageRegistry', 'taskCenter']` 这样的显式声明，兄弟服务的能力以参数显式传递。**禁止运行期探测**（`ctx.get('…')`、`?.` 能力探测、"缺席即降级"分支）：真实宿主的属性守卫按被访问 ctx 的属主归因，访问本身就抛，那条降级通道从未生效过。确实需要"框架缺席也能激活"的隔离，正确做法是 G2 的拆包，不是探测。
2. **注册应用** —— `ctx.apps.register({ id, name, description, entry, instructions?, toolPrefix? }, ctx)`。第二个参数传你自己的 fiber：插件卸载时整个应用（页面+工具）随之摘除。`entry` 是应用内页面**键**，不是 URL。
3. **定义工具目录** —— `const tools = ctx.apps.tools(id, ctx)`，逐个 `tools.define(defineTool({...}), meta?)`。工具本体一律用 `@deepseek-ai/dsh-tools` 的 `defineTool` 产出（DSH `ToolDefinition`：name/description/parameters/output/execute，参数用逐属性 schema，`required: true` 标必填）；本地名 ≤24 字符、应用内唯一，注册表对外拼成 `<toolPrefix>__<本地名>`。能力等应用侧元数据（如 `requires: ['tasks:send']`）放 define 的第二个参数——工具本体保持纯 DSH 形状（第 1 阶段只记录、不强制）。工具必须先于页面定义：页面 `tools` 字段引用的本地名会对照目录校验（fail loud）。
4. **定义页面** —— 用 `@veren/prompt-page` 的 `defineAppPage` 写页面（URL 必须是 `/apps/<appId>/...`），再 `ctx.apps.pages(id, ctx).register(page)`。不要声明 `preset`；改声明 `tools`、`instructions`、`instanceTitle`。**页面注册是单入口**：app-registry 会自动把页面镜像进 page-registry 的 URL 索引（`openUrl` 才能解析它）；应用作者不要再自己调 `ctx.pageRegistry.registerAppPage`（那是内部原语），镜像失败会回滚并抛错，不会出现"目录可见却打不开"的静默漂移。
5. **全有或全无的接线（G13 规则 3）** —— 定义 → 工具 → 页面收进**单个 `ctx.effect`**；体内任何一步失败都把已完成的步骤逆序回滚再抛出，绝不留下"应用在、工具缺页"的半接线状态（见 `tests/app.spec.ts` 的回滚用例）。

任务结构（§4.7）：任务条目带 `parentId`（创建时写一次、不可变——本地 store 同样如此，环因此结构上不可能）；整棵子树的进度是派生的 `2/5` 徽标（全树终态/全树节点），不落 store。详情页渲染子任务树区——活跃分支默认展开、终态分支折叠成进度徽标——`instanceTitle` 始终是根任务标题；子任务没有自己的 URL 和会话。`split_task` 把已接取节点拆成一条 open 子任务（仅当前接取者可用；安全上限深度 ≤ 8 / 单节点 32 子 / 单树 200 节点，超限返回 `task/subtree-limit`）；发布不支持带子任务的嵌套模板（§4.7.6）。

让它成为「应用」而不是「插件」的规则：id 与工具前缀全宿主唯一、校验 fail loud；页面统一收在 `/apps/<appId>/` 命名空间下；生命周期绑定你的 fiber（用 `ctx.effect` 按可逆序登记清理）；永远不碰用户自选的预设。

设计依据见 `docs/application-concept.cn.md`（§2–§4、§7.1、§8.1）。
