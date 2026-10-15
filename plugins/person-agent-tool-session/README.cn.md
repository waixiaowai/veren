# @veren/person-agent-tool-session

Person Agent 预设的面向模型会话维护工具：基于 `ctx.sessionController` 的 `session_create`、`session_rename`、`session_fork`，以及基于 `ctx.workspaceRegistry` 的 `session_archive`、`session_unarchive`、`session_pin`、`session_unpin`。

## 什么情况下使用

当 Person Agent 会话需要创建或整理兄弟会话——按预设/模型/标题开新会话、分叉已完成轮次、归档或置顶会话——时使用；当会话不允许改动会话名单时跳过。

## 最小配置

由 preset 作为子行组合（无需 `cordis.patch.yml`，加载器按包名加载）：

```yaml
- id: tool-session
  name: '@veren/person-agent-tool-session'
  config:
    allowCreate: true
    allowFork: true
    allowArchive: true
    allowPin: true
```

## 工具

| 工具 | 参数 | 效果 |
| --- | --- | --- |
| `session_create` | `title?`、`presetId?`、`provider?`+`model?`、`workspaceId?` 与 `cwd?` 二选一 | 创建普通会话，然后按「先模型、后标题」的顺序补装。新会话从空白开始；工具只回报新 id，不切换会话。 |
| `session_rename` | `sessionId`、`title` | 持久修改一个会话的标题。 |
| `session_fork` | `sessionId`、`atSeq?` | 把精确的已完成轮次前缀复制成新会话。 |
| `session_archive` | `sessionId`、`stopActivity?` | 把会话放进归档集合；给 `stopActivity` 时停止运行中的工作而不是拒绝。 |
| `session_unarchive` | `sessionId` | 把归档会话移回原位。 |
| `session_pin` / `session_unpin` | `sessionId` | 维护 registry-global 置顶集合。 |

错误是结构化的，带稳定 code（`SESSION_TITLE_EMPTY`、`SESSION_CREATE_LOCATION_CONFLICT`、`SESSION_MODEL_SELECTION_INCOMPLETE`）与机器可读字段；注册表层级的拒绝（会话仍在运行、归档会话置顶）原样来自宿主接缝。

## 实现说明

- `src/index.ts` — 插件身份、开关与 effect 托管的注册（逆序清理，HMR 安全）。
- `src/tools-management.ts` — 走 `ctx.sessionController` 的创建/改名/分叉。
- `src/tools-state.ts` — 走 `ctx.workspaceRegistry` 的归档/置顶动词。
- `src/types.ts` — 参数/返回值契约与结构化错误类型。

## 延伸阅读

- 宿主 Session 业务 API：`@deepseek-ai/dsh-api-session-controller`（`ctx.sessionController`）。
- 归档/置顶语义：`@deepseek-ai/dsh-workspace`（`ctx.workspaceRegistry`）。
- 工具契约：`@deepseek-ai/dsh-tools`（`defineTool`、`ctx.tools.register`）。
