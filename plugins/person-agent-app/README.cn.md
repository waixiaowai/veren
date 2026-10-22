# @veren/person-agent-app

把 **Person Agent**（人机桥）暴露为一等 Veren 应用：个人工作台概览 + 工作区浏览，统一挂在宿主应用目录的 `/apps/person-agent/...` 下。

## 注册了什么

- **应用** `person-agent`（工具前缀 `person_agent`），入口页面 `overview`。
- **页面**（自承载组件：模块级 PageFC，同步服务面在正文里直接读——每帧最新、零状态；异步面走 `ctx.effect` 拉取 + `useState`，无工厂、无快照契约）
  - `overview` — `/apps/person-agent/overview`（入口）：一屏看清部署真实状态——应用目录与工作区正文直读（`ctx.apps.catalog()` / `ctx.workspaceRegistry.list()`，首帧即真实数据），待办任务异步刷新（`ctx.taskCenter.list`，读取失败如实标注原因）；"某工作区有哪些会话"是现查事实，由本页挂载的只读工具 `workspace_session_list` 承接。apps/tasks 两区明确不承诺下钻。
  - `workspaces` — `/apps/person-agent/workspaces`：正文直读工作区行，零状态零 effect；会话明细走收编的 `workspace_session_list` 工具按需查询。
- **收编工具**（复用而非重写——本包调用兄弟工具包导出的定义构建器，页面工具与宿主工具是同一份 `ToolDefinition`）：
  - `workspace_session_list`（来自 `@veren/person-agent-tool-workspace`）：`overview` 与 `workspaces` 两页都挂载；
  - `session_create`、`session_rename`（来自 `@veren/person-agent-tool-session`）：目录备用项，目前没有任何页面挂载——因此也没有任何页面承诺它们（"承诺了但没有"零容忍：挂载与承诺必须同进退）。

刻意排除项及理由：`session_dispatch`（派活语义属于带结算看守的 agent 会话，不属于页面会话）、`session_archive/unarchive/pin/unpin`（改变可见性的维护动词，无页面流程）、`workspace_create/rename`（工作区维护留在桥梁自己的工具面；页面只读）。

## 依赖与失败语义（G13）

四个服务依赖全部是**声明的硬 inject**：`apps`、`pageRegistry`、`workspaceRegistry`、
`taskCenter`，不做任何运行期探测（`ctx.get('…')` 的探测通道在真实宿主上根本
不存在——属性守卫按属主归因，访问本身就抛）。

没有独立的数据面模块：页面组件在正文里**直接读**宿主服务面——同步面（`ctx.apps` / `ctx.workspaceRegistry`）正文直调、每帧最新；异步面（`ctx.taskCenter`）`ctx.effect` 拉取、`useState` 落地，读取失败如实渲染。组件 ctx 携带完整宿主服务面（声明合并），页面不需要任何中介层；其他插件同理直接读这三个服务面即可。

- 目录与工作区是同步内存读，读取本身不会失败；
- 任务中心是异步读：读取失败（存储后端故障等）时 tasks 区显式 `available=false`
  并给出原因——绝不假装有数据。服务缺席不是可能的失败（硬 inject 保证在场）。

## 组合

经 `@veren/person-agent-bundle` 组合包安装；bundle patch 在原样保留 `person-agent-preset` 行**之外**追加本行。本插件纯追加：即使它激活失败，Person Agent 预设的运行行为也不变。

## 开发

```bash
pnpm --dir plugins/person-agent-app test        # vitest 单测
pnpm --dir plugins/person-agent-app typecheck   # tsc --noEmit
```
