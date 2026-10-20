# @veren/person-agent-app

把 **Person Agent**（人机桥）暴露为一等 Veren 应用：个人工作台概览 + 工作区浏览，统一挂在宿主应用目录的 `/apps/person-agent/...` 下。

## 注册了什么

- **应用** `person-agent`（工具前缀 `person_agent`），入口页面 `overview`。
- **页面**
  - `overview` — `/apps/person-agent/overview`（入口）：一屏看清部署真实状态——应用目录（`ctx.apps.catalog()`）、工作区/会话账目（`ctx.workspaceRegistry`）、待办任务（`ctx.taskCenter`，缺席时降级）。
  - `workspaces` — `/apps/person-agent/workspaces`：每个工作区一行，附会话账目数；会话明细走收编的 `workspace_session_list` 工具按需查询。
- **收编工具**（复用而非重写——本包调用兄弟工具包导出的定义构建器，页面工具与宿主工具是同一份 `ToolDefinition`）：
  - `session_create`、`session_rename`（来自 `@veren/person-agent-tool-session`）
  - `workspace_session_list`（来自 `@veren/person-agent-tool-workspace`）

刻意排除项及理由：`session_dispatch`（派活语义属于带结算看守的 agent 会话，不属于页面会话）、`session_archive/unarchive/pin/unpin`（改变可见性的维护动词，无页面流程）、`workspace_create/rename`（工作区维护留在桥梁自己的工具面；页面只读）。

## 降级策略

所有数据源都是按需读取、可能缺席：

- `ctx.apps` / `ctx.pageRegistry` 是硬注入（本插件**就是**应用）。
- `ctx.workspaceRegistry` 与 `ctx.taskCenter` **不**硬注入：页面经 `ctx.get` 读取，缺席时显示 `available=false` 并给出原因——绝不假装有数据。

## 组合

经 `@veren/person-agent-bundle` 组合包安装；bundle patch 在原样保留 `person-agent-preset` 行**之外**追加本行。本插件纯追加：即使它激活失败，Person Agent 预设的运行行为也不变。

## 开发

```bash
pnpm --dir plugins/person-agent-app test        # vitest 单测
pnpm --dir plugins/person-agent-app typecheck   # tsc --noEmit
```
