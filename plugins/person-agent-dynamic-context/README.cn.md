# @veren/person-agent-dynamic-context

Person Agent 的工作记忆：在会话创建时把预设名单与工作区列表注入该会话的系统提示词，每个会话只读一次。当 Person Agent 预设的会话需要知道有哪些兄弟预设与工作区时安装本插件；不希望会话看到名单或工作区时跳过。

## 工作方式

- 被组合进预设的 `plugins` 列表 = 生效；不组合 = 不存在。不注册任何全局内容。
- 名单以**带来源的 user 快照消息**注入（`time-context` 同一模式）：前置的 `agent/pre-step` 监听器 await 预设名单读取、现读工作区列表，与会话上一条快照比较，仅变化时追加。
- 因为读取在监听器内被 await，注册表变化在会话的**下一次步骤精确可见**——无缓存、无轮询、无一次组装的滞后。
- 贡献的来源标识为 `person-agent-context`；值未变化时不向历史追加任何内容。

## 配置

| 选项 | 默认 | 含义 |
| --- | --- | --- |
| `includePresetRoster` | `true` | 注入预设名单。 |
| `includeWorkspaceList` | `true` | 注入工作区列表。 |

## 卸载 / HMR

prompt section 经 `ctx.effect` 注册，插件卸载或热更时按逆序移除，不会泄漏。

## 测试

```bash
pnpm test          # 单测 + 组合测试（真实 cordis Context，假服务面）
```

真实宿主的 e2e 由 `@veren/person-agent-preset` 的 e2e 间接覆盖：它通过真实 Loader 挂载本插件。
