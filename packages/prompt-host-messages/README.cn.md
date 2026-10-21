# Prompt Host Messages（消息流宿主）

[English](./README.md) | 中文

## 是什么 / 何时用

`@veren/prompt-core` 的消息日志宿主渲染器——本架构中的 `react-dom`。它把 fiber 副作用（placement/update/deletion）提交为只追加的 `SNAPSHOT`/`PATCH` 消息流，并维护版本化同步。用于页面组件与 LLM chat API 之间。provider 特定的缓存断点策略在本包（`cache.ts` + `compact.ts`）；内核保持 provider 无关。

## Provider 策略（经 `createSyncAssembler` 接线）

- **缓存断点** —— `planMessages(policy, systemPrompt, syncs)` 组装上下文块并按 provider 摆断点：`anthropic` 尾部同步消息显式 `ephemeral`（≤4 个）；`deepseek`/`openai` 零显式标记（自动前缀缓存）。`policyFor(provider)` 把 provider 名映射为策略。**未知 provider 的默认行为（显式、非静默）：deepseek 语义**——自动前缀缓存、零显式标记；要依赖断点先在此登记策略。
- **预算压实** —— `tokenBudgetPolicy` 盯 `host.logStats()`（条数 / 近似 token 阈值，默认 200 条 / 20 万 token）；`remount(host)` anchor 并产出新基线快照（一次缓存 miss 换干净前缀）。`createSyncAssembler({ host, policy, systemPrompt?, budget? })` 把两者接在一起：每次 `assemble()` 内部推进游标、预算触顶即 remount，返回 `{ remounted, empty, blocks, chat, text }`。
- 本仓库的接线点：`@veren/prompt-page` `mountPage({ assembly })` → `session.assemble()`，以及 page-sync-bench 的 pre-step 注入。DSH 宿主链路上最终请求的 cache control 归平台 LLM 层；装配器的块面供自建请求的独立运行时使用。

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
