# Select Model（会话内模型切换）

一个宿主（Host）插件，开放运行时工具 `select_model`，让会话在对话过程中切换自己的 **provider/model 路由**与可选的**推理强度（reasoningEffort）**。切换逻辑完全复用宿主的 `ctx.sessionController.selectModel`，本插件只做参数校验与错误透传；不改宿主代码，不重复造模型解析逻辑。

[English](./README.md)

## 工具

`select_model`

| 参数 | 类型 | 含义 |
| --- | --- | --- |
| `provider` | string，必填 | Provider id（与 `model` 成对给出） |
| `model` | string，必填 | 模型 id（与 `provider` 成对给出） |
| `reasoningEffort` | string，可选 | 该路由的推理强度（由适配器解释，如 `low`/`medium`/`high`） |
| `sessionId` | string，可选 | 目标会话 id；**缺省表示"当前调用方会话"** |

返回 `{ sessionId, provider, model, reasoningEffort? }` —— 宿主解析并接受后的值（宿主未返回 effort 时该键缺省）。

## 默认行为与跨会话策略

- **缺省（不传 `sessionId`）：** 只切换调用方会话自己的模型。这是最常见用法："把我现在切到 X"。
- **显式传 `sessionId`：** 允许切换**别的会话**的模型。这是刻意的设计决定：会话 id 本来就出现在模型的工作记忆快照里；会话是否存在由宿主裁决（不存在的 id 会带着宿主错误失败）；切换只改目标会话自己的路由，**不会写部署级默认模型**。调用方仍应把"切别人的会话"当作该会话所有者的事，代用户操作时明确说明。

## 错误码

工具层错误带稳定 code；宿主的错误原样透传：

| Code | 含义 |
| --- | --- |
| `SELECT_MODEL_INVALID_ARGUMENT` | 参数不是对象、出现未知键，或某个应为非空字符串的字段（`sessionId`、`reasoningEffort`、`provider`、`model`）缺省/空白/类型不对 |
| `SELECT_MODEL_PROVIDER_MODEL_REQUIRED` | `provider` 与 `model` 必须成对给出 |
| `SELECT_MODEL_NO_CALLER` | 未传 `sessionId` 且本次调用也没有关联的调用方会话 |

宿主侧失败（provider/model 未知、会话不存在、effort 非法）以宿主自己的错误信息冒出。

## 安装 / 启用 / 停用

用 `plugin_manager`（Web 插件页面或同名工具）安装本目录（一个 bundle）：

```text
install_bundle target=C:\Users\imeep\Documents\cursour\plugins\select-model
```

Bundle 名为 `@imeep/dsh-select-model`。启用/停用：

- `set_bundle { target: "@imeep/dsh-select-model", enabled: false }` 整体开关；
- 或 `set_plugin { target: "<entryId>", enabled: false }` 只开关这一行（entry id 为 `select-model`）；
- `remove_bundle` 卸载。

## 配置

当前没有可调项；schema 是空对象（`Config`），保留以满足宿主统一配置契约，未来新增开关无需迁移既有配置行。

## 测试

```bash
pnpm --dir plugins/select-model test
```
