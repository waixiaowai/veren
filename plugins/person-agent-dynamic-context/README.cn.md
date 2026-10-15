# @veren/person-agent-dynamic-context

Person Agent 的工作记忆：把预设名单、可用模型目录（provider、多模态输入支持、上下文窗口）与工作区列表以快照消息注入会话上下文。当 Person Agent 预设的会话需要知道有哪些兄弟预设、模型与工作区时安装本插件；不希望会话看到这些名单时跳过。

## 工作方式

- 被组合进预设的 `plugins` 列表 = 生效；不组合 = 不存在。不注册任何全局内容。
- 工作记忆拆成**三条具名小消息**：`Agent Preset List`、`Model Catalog`、`Workspace List`。前置的 `agent/pre-step` 监听器 await 预设名单读取、现读模型目录与工作区列表，然后逐块把区块文本与会话日志里该区块最近一次的记录比较——**只有变化的区块才追加**；没有变化的步骤零追加。
- 模型目录读取活跃 LLM 注册表（`listProviders` → `listModels` → `resolveModelInfo`）——与 GUI 模型选择器同源——每个模型一行渲染输入模态与上下文窗口。
- 会话以表格渲染（`id | title | preset | provider | model | created at`），挂在各工作区之下，并带来自 agent 注册表的实时 `· running` 标记——运行状态翻转会使工作区区块重新追加（变化即追加，是预期行为）。
- 变化检测扫描会话日志，进程重启后依然成立，无需内存状态。
- 每条消息的来源里记录了区块名（`person-agent-context` 携带 `sections`），按块比较读的正是它。

## 配置

| 选项 | 默认 | 含义 |
| --- | --- | --- |
| `includePresetRoster` | `true` | 注入预设名单。 |
| `includeModelCatalog` | `true` | 注入模型目录（provider、多模态支持与上下文窗口）。 |
| `includeWorkspaceList` | `true` | 注入工作区列表。 |

## 卸载 / HMR

prompt section 经 `ctx.effect` 注册，插件卸载或热更时按逆序移除，不会泄漏。

## 测试

```bash
pnpm test          # 单测 + 组合测试（真实 cordis Context，假服务面）
```

真实宿主的 e2e 由 `@veren/person-agent-preset` 的 e2e 间接覆盖：它通过真实 Loader 挂载本插件。
