# @veren/person-agent-tool-workspace

Person Agent 预设的面向模型工作区维护与检索工具：基于 `ctx.workspaceRegistry` 的 `workspace_create`、`workspace_rename` 与 `workspace_session_list`。

## 什么情况下使用

当 Person Agent 会话需要自己维护工作区名单——把一个目录登记为新工作区、修改已有工作区标题、或按 preset、provider/model 与归档状态检索一个工作区账目下的会话——时使用；当会话不允许触碰工作区注册表时跳过。

## 最小配置

由 preset 作为子行组合（无需 `cordis.patch.yml`，加载器按包名加载）：

```yaml
- id: tool-workspace
  name: '@veren/person-agent-tool-workspace'
  config:
    allowCreate: true
    allowCreateDirectory: false
    allowListSessions: true
    maxListSessions: 200
```

## 工具

| 工具 | 参数 | 效果 |
| --- | --- | --- |
| `workspace_create` | `path`（必填）、`title?`、`createDirectory?` | 把已存在目录登记为工作区；规范路径已被拥有时复用原记录。 |
| `workspace_rename` | `workspaceId`（必填）、`title`（必填） | 修改一个已有工作区的显示标题。 |
| `workspace_session_list` | `workspaceId`（必填）、`agentPreset?`、`provider?`、`model?`、`archived?`（`exclude`/`only`/`include`，默认 `exclude`）、`limit?` | 列出一个工作区账目下的会话，创建时间新的在前；`total` 是截断前的命中总数。 |

`workspace_session_list` 的过滤语义：

- `agentPreset`、`provider`、`model` 均为对会话事实的精确匹配。挂载中的会话读持久化 `modelSelection` 投影的 `lastUsed`；冷会话（已持久化未挂载）经日志折叠最新一条 `model/selection` 事件。无法确定路由的会话永远不命中 `provider` 或 `model` 过滤。
- preset 取自会话头；当前版本创建后不会变化。
- 归档状态取注册表全局归档集；`archived` 三态分别表示只看未归档（默认）、只看已归档、全部。

错误是结构化的，带稳定 code（`WORKSPACE_PATH_NOT_A_DIRECTORY`、`WORKSPACE_TITLE_EMPTY`、`WORKSPACE_NOT_FOUND`、`WORKSPACE_CREATE_DIRECTORY_DISABLED`、`WORKSPACE_LIST_LIMIT_INVALID`）与机器可读字段——配置错误显性失败，而不是靠猜。

## 实现说明

- `src/index.ts` — 插件身份、配置与 effect 托管的注册（逆序清理，HMR 安全）。
- `src/tools.ts` — `workspace_create` / `workspace_rename` 注册。
- `src/session-list.ts` — `workspace_session_list` 注册、过滤条件与 limit 处理。
- `src/session-facts.ts` — 单会话事实解析（挂载会话读投影、冷会话折叠日志），与工作记忆列表同源的宿主数据源。
- `src/types.ts` — 参数/返回值契约与结构化错误类型。

## 延伸阅读

- 注册表语义：`@deepseek-ai/dsh-workspace`（create/复用、`setTitle`）。
- 工具契约：`@deepseek-ai/dsh-tools`（`defineTool`、`ctx.tools.register`）。
