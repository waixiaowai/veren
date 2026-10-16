# @veren/person-agent-preset

中文 | [English](README.md)

## 简介

一个 DSH 宿主插件，通过 `@deepseek-ai/dsh-agent-preset-registry` 的 `ctx.agentPresets.register()` 在运行时动态注册 **Person Agent** 预设。Person Agent 是**人类与 DSH 之间的沟通桥梁**：一个「总管」人设——理解用户真正需要什么、先想清楚再想（元认知）、用平实的简体中文沟通，并把活派给自己创建的、配置得当的会话——工作区、预设、提供商与模型都由它自己判断。派活人设与两类维护工具（工作区 + 会话）**常开**：没有开关，因为不能路由工作的桥梁不是桥梁。如果会话绝不允许创建或路由其他会话，则不要使用本插件。

## 预设组成

| 子插件行 | 作用 |
|---|---|
| `persona`（`@deepseek-ai/dsh-persona`） | 桥梁人设，是人格不是流程：身份（总管，从不亲自干活）、思考前的思考、思维方式、与人类的沟通方式、派发任务的沟通方式 |
| `tool-fs` / `tool-fs-search` | 文件读取与搜索 |
| `present`（`@deepseek-ai/dsh-tool-present`） | 把文件/图表/文档作为客户端文件卡片交付 |
| `tool-todo` / `tool-ask-user` | 进度跟踪与向用户提问 |
| `tool-web`（可选，`withWeb`） | 需要调研时的联网搜索 |
| `tool-workspace`（`@veren/person-agent-tool-workspace`，常开） | `workspace_create` / `workspace_rename`，给活找一个家 |
| `tool-session`（`@veren/person-agent-tool-session`，常开） | `session_create` / `session_rename` / `session_fork` / 归档 / 置顶——派活的出口 |
| `dynamic-context`（`@veren/person-agent-dynamic-context`） | 工作记忆：预设名单、模型目录与工作区列表的快照消息 |

## 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `presetId` | `person-agent` | 会话记录的稳定预设身份 |
| `order` | `5` | 客户端预设选择器中的排序 |
| `withWeb` | `true` | 是否包含联网搜索工具 |

## 工作原理

`apply` 调用 `ctx.agentPresets.register(definition)`，并把返回的卸载函数交给 `ctx.effect`，插件卸载时按逆序清理定义。已存在的 Agent 保持原组成不变，只有新建会话才会使用该预设。定义由注册表按修订管理——不修改任何磁盘文件。

本插件**不自带 bundle**（刻意不声明 `dsh.bundle.patch`）：它只是普通依赖，把它的行插入 profile 的那一层在 `@veren/person-agent-bundle` 里。请通过该组合包安装，或在 patch 里自行列出这一行：

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
