# @veren/person-agent-preset

中文 | [English](README.md)

## 简介

一个 DSH 宿主插件，通过 `@deepseek-ai/dsh-agent-preset-registry` 的 `ctx.agentPresets.register()` 在运行时动态注册 **Person Agent** 预设。适用于部署中存在"面向人类汇报"的会话场景：小白能懂的平实语言、可视化优先的总结（表格、Mermaid 图、清单）、通过 `present` 工具交付成品文件。如果所有使用者都是直接看原始输出的开发者，则不需要本插件。

## 预设组成

`dynamic-context` 子行引用独立包 **@veren/person-agent-dynamic-context**（行名 = 包名，从私有仓库 npm.veren.top 或工作区链接解析）：它在每个步骤准备时（agent/pre-step）把预设名单与工作区列表作为带来源的快照消息追加进会话（工作记忆），值变化才追加。

| 子插件行 | 作用 |
|---|---|
| `persona`（`@deepseek-ai/dsh-persona`） | 汇报风格：平实语言、先给可视化总结、交付成品、最多三条下一步建议 |
| `tool-fs` / `tool-fs-search` | 完成工作所需的文件读取与搜索 |
| `present`（`@deepseek-ai/dsh-tool-present`） | 把文件/图表/文档作为客户端文件卡片交付 |
| `tool-todo` / `tool-ask-user` | 进度跟踪与向用户提问 |
| `tool-web`（可选，`withWeb`） | 需要调研时的联网搜索 |

## 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `presetId` | `person-agent` | 会话记录的稳定预设身份 |
| `order` | `5` | 客户端预设选择器中的排序 |
| `withWeb` | `true` | 是否包含联网搜索工具 |
| `refreshMs` | `30000` | 动态 suffix 的刷新周期（毫秒）：轮询两个注册表并做内容 diff，只有名单真正变化时才重注册（换 revision）；`0` 关闭刷新 |

## 工作原理

`apply` 调用 `ctx.agentPresets.register(definition)`，并把返回的卸载函数交给 `ctx.effect`，插件卸载时按逆序清理定义。已存在的 Agent 保持原组成不变，只有新建会话才会使用该预设。定义由注册表按修订管理——不修改任何磁盘文件。

```yaml
- id: person-agent-preset
  name: '@veren/person-agent-preset'
  config:
    presetId: person-agent
```

## 测试

```bash
pnpm test        # 单元测试（mock 注册表与 effect 语义）
pnpm test:e2e    # 真实宿主 e2e：启动真实 dsh web（~/.dsh_test 一次性主目录）
```

e2e 通过一个宿主内探针插件完成断言：轮询 `agentPresets.remoteExportList()` 直到 `person-agent` 出现，用 `readDocument()` 读取渲染的组合 YAML（须包含人设提示词与 `dsh-tool-present`），并在子 context 上真实挂载（走真实 Loader 与激活审计），最后把 JSON 结论写给 spec 断言。宿主版本较新时，e2e 会暴露插件 schema 漂移（例如 `dsh-tool-todo` 的必填 `allowParallelInProgress`）。运行前置：插件已 `pnpm build`，且上两级存在 harness 检出（`deepseek/deepseek-harness`）。

## 限制

- 依赖 `agentPresets` 服务（必须已挂载 `@deepseek-ai/dsh-agent-preset-registry`）。
- 预设不是安全沙箱；人设只约束汇报风格。
- 已开始的会话保持原预设（`agent-preset/locked`）。
