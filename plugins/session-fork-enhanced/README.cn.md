# 会话分叉增强（Session Fork Enhanced）

一个 Host 插件：把已有会话的**已完成轮次前缀（完整上下文）**分叉成新会话，并可为新分支指定**预设**与**模型**。不修改 DSH 任何源码，也不改动官方 `session_fork`。

[English](./README.md)

## 工具

`session_fork_with_options`

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `sessionId` | string，必填 | 源会话 id |
| `atSeq` | integer，可选 | 精确的源事件序号（含）；省略时为最近一个已完成轮次 |
| `presetId` | string，可选 | 新分支使用的预设 id；省略时继承源会话预设 |
| `provider` + `model` | string，必须同时给 | 新分支下一轮请求使用的模型；省略时按官方 fork 规则继承源日志的有效模型 |
| `reasoningEffort` | string，可选 | 该 provider/model 的推理强度；需要同时给 provider/model |

返回值：`{ sessionId, sourceSessionId, atSeq, inheritedEventCount, agentPreset?, provider, model, reasoningEffort? }`。

## 行为

- 上下文复制与官方 `session_fork` 完全一致：`buildForkSeed` 复制前缀、写入 `session/end-seed`、为开放尾部补合成 closers，`inheritedEventCount = boundary + 1`。
- 预设：取 `agentPresets.resolve(presetId ?? 源会话预设)`，在 `setup` 里 `mount`，并在新会话 header 记录 `agentPreset`。创建时指定预设，不触发 `agent-preset/locked`。
- 模型：解析 `llm.resolveCallConfig` 后作为 `agentOptions` 创建；若与继承日志的有效模型不同，再向新会话追加一条持久的 `model/selection` 事件。这样：
  - 新分支第一轮请求由 `agentOptions` 决定（不安装额外的 selection listener，避免和 Session Controller 的同类 listener 叠加）；
  - 之后冷恢复时，Session Controller 读到的 `pending` 就是新模型，不会被切点处的旧 `request/header` 盖住。
- **不写全局默认模型**：不使用 `sessionController.selectModel`（它会把选择写回 `agentDefaultModel`），因此多分支并行不会污染部署默认值。
- 工作区：与源会话相同的 workspace 归属，`attachSession` 后出现在会话列表。
- 省略 `presetId`/`provider`/`model` 时，边界、预设、有效模型、header 元数据与官方 fork 一致。

## 安装 / 启用 / 关闭

用 `plugin_manager`（Web 的 Plugins 页或同名工具）安装本目录（bundle 包）：

```text
install_bundle target=C:\Users\imeep\Documents\cursour\plugins\session-fork-enhanced
```

对应的 bundle 名：`@imeep/dsh-session-fork-enhanced`。启用/关闭：

- `set_bundle { target: "@imeep/dsh-session-fork-enhanced", enabled: false }` 关闭整个 bundle；
- 或 `set_plugin { target: "<entryId>", enabled: false }` 只关这一行（entry id 形如 `session-fork-enhanced`）；
- `remove_bundle` 卸载。

## 与官方 `session_fork` 的关系

- 工具名不同（`session_fork_with_options` vs `session_fork`），参数不同，可并存，不冲突。
- 官方工具仍由 `@veren/person-agent-preset` 按预设挂载；本插件注册在 Host 根上下文，因此所有预设都能看到它。
- 两者都会创建普通会话、复制上下文、附着同一 workspace；区别只是本插件允许在创建时覆盖预设和模型。

## 配置

本插件当前没有可调项；schema 为空对象（`Config`），保留此结构是为了未来新增开关时无需迁移既有配置行。

## 测试

```bash
pnpm --dir plugins/session-fork-enhanced test
```
