# @veren/task-workbench

Veren **应用**的参考实现：在 `@veren/app-registry`、`@veren/page-registry` 与 `@veren/prompt-page` 之上注册 `task-workbench` 应用（id、入口页面、页面集合、工具目录、任务通道）。把本包当作「怎样写一个 Veren 应用」的样板来抄，而不是当库用。

[English](./README.md)

## 注册了什么

| 部分 | 值 |
| --- | --- |
| 应用 id | `task-workbench`（工具前缀 `task_workbench`） |
| 入口页面 | `list` → `/apps/task-workbench/list` |
| 页面 | `/apps/task-workbench/list`、`/apps/task-workbench/task/:taskId`、`/apps/task-workbench/publish` |
| 工具 | `task_workbench__take_task`、`__complete_task`、`__abandon_task`、`__publish_task` |
| 任务通道 | `ctx.taskCenter` 在场时走 `send`；缺席时降级为本地列表 |

页面不再绑定预设。每页声明 `tools`（应用内本地名）、`instructions`（给模型的说明，不是系统提示词）、`instanceTitle`（如 `/task/:id` 实例化为「任务 #1」）与 `pageRevision`。

## 测试

```bash
pnpm --filter @veren/task-workbench test
pnpm --filter @veren/task-workbench typecheck
```

## 怎样写一个 Veren 应用

一个 Veren 应用就是按 `apply` 里四步走完的普通 DSH 插件：

1. **注册应用** —— `ctx.apps.register({ id, name, description, entry, instructions?, toolPrefix? }, ctx)`。第二个参数传你自己的 fiber：插件卸载时整个应用（页面+工具）随之摘除。`entry` 是应用内页面**键**，不是 URL。
2. **定义工具目录** —— `const tools = ctx.apps.tools(id, ctx)`，逐个 `tools.define({ name, description, parameters, requires?, execute })`。用本地名（≤24 字符，应用内唯一）；注册表对外拼成 `<toolPrefix>__<本地名>`。工具必须先于页面定义：页面 `tools` 字段会对照目录校验（fail loud）。
3. **定义页面** —— 用 `@veren/prompt-page` 的 `defineAppPage` 写页面（URL 必须是 `/apps/<appId>/...`），再 `ctx.apps.pages(id, ctx).register(page)`。不要声明 `preset`；改声明 `tools`、`instructions`、`instanceTitle`、`pageRevision`。**页面注册是单入口**：app-registry 会自动把页面镜像进 page-registry 的 URL 索引（`openUrl` 才能解析它）；应用作者不要再自己调 `ctx.pageRegistry.registerAppPage`（那是内部原语），镜像失败会回滚并抛错，不会出现"目录可见却打不开"的静默漂移。
4. **接任务通道（可选）** —— 惰性探测 `ctx.taskCenter`，在场就 `send(draft)`（target 用规范 URL）。任务中心未激活时记录降级、本地继续工作；绝不因此让应用激活失败。

让它成为「应用」而不是「插件」的规则：id 与工具前缀全宿主唯一、校验 fail loud；页面统一收在 `/apps/<appId>/` 命名空间下；生命周期绑定你的 fiber（用 `ctx.effect` 按可逆序登记清理）；永远不碰用户自选的预设。

设计依据见 `docs/application-concept.cn.md`（§2–§4、§7.1、§8.1）。
