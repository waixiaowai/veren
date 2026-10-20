# Prompt Host Messages（消息流宿主）

[English](./README.md) | 中文

## 是什么 / 何时用

`@veren/prompt-core` 的消息日志宿主渲染器——本架构中的 `react-dom`。它把 fiber 副作用（placement/update/deletion）提交为只追加的 `SNAPSHOT`/`PATCH` 消息流，并维护版本化同步。用于页面组件与 LLM chat API 之间。provider 特定的缓存断点策略属于这一层（尚未实现）；内核保持 provider 无关。

## 语义（LLM 特有策略层）

- **append（placement）**：结构化 op 入缓冲；`flush()` 合批并推进版本。
- **revise（update）**：历史物理不可改 → 以新值重申（splice/set 天然幂等）。
- **evict（deletion）**：无 `entity` 的 `splice` / `remove` op；镜像集合状态同步剔除。
- **renderSince(cursor)**：增量优先；无基线/缺口过大/游标超前 → 从镜像状态回落全量快照。
- **anchor（压实）**：补丁链超过 `compactEvery` → 清链；过期游标回落快照。

## 线上格式（字节稳定模板）

```
SNAPSHOT vN {"nodes":[{"content":"...","kind":"static"},{"items":[...],"kind":"keyed","path":"tasks"}]}
PATCH vA->vB {"ops":[{"entity":{...},"id":"t-1","op":"splice","path":"tasks"}]}
```

## 运行

```bash
pnpm --filter @veren/prompt-host-messages test
```
