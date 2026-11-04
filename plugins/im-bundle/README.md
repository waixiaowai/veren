# @veren/im-bundle

The multi-agent collaboration workspace for a DSH host as one installable
layer: the provider-neutral core, the conversation / coordination / turn
domains, the model-facing `im_*` tools with the collaboration skill, the WeChat
channel, and the web panel — wired in fact-pipeline order by a single bundle
patch.

面向 DSH 宿主的多智能体协作工作区，一个安装层搞定：渠道中立核心、会话 / 协调 / 回合三个
域、带协作技能的面向模型 `im_*` 工具、微信渠道与 Web 面板，由一个组合包 patch 按
事实管线顺序接线。

## When to use / 什么时候使用

Use when a profile should host a workspace where humans and agents share one
message flow: channel observations settle into durable rooms, deterministic
triage decides who wakes, write gates keep two agents from saying the same
thing, runs are replayable records, and the panel shows the conversations.

当 profile 需要承载一个人与智能体共享同一条消息流的工作区时使用：渠道观察沉淀为持久
房间、确定性分流决定谁被唤醒、写入闸门保证两个智能体不会说同一句话、运行是可回放的
记录，面板呈现会话。

This is a configuration-only bundle: zero runtime code, seven loader rows.
这是纯配置组合包：零运行时代码，七行 loader 行。

## Members / 成员

| Row | Package | Provides |
|---|---|---|
| `im` | `@veren/im` | the `im` / `imPeople` / `imParticipants` / `imMemory` / `imBindings` / `imDirectory` / `imIntake` services; emits `im/message-observed` |
| `im-conversation` | `@veren/im-conversation` | the `imConversation` service: rooms, sequences, read cursors, channel ingest; emits `im/message-new`; owns the `imConv` remote namespace |
| `im-coordination` | `@veren/im-coordination` | the `imCoordination` service: triage, budget, watermarks, write gates; emits `im/wake-request` (the only wake source) |
| `im-turn` | `@veren/im-turn` | the `imTurn` service: run records, per-agent preset sessions, hold loops |
| `im-wechat` | `@veren/im-wechat` | the WeChat iLink channel: QR authorization, long-poll inbound, outbound delivery of agent-authored room messages |
| `im-tool` | `@veren/im-tool` | the `im_*` model tools + the `im-collaboration` skill |
| `im-ui` | `@veren/im-ui` | the web panel: conversations / cloud / intake |

`@veren/im-hub` (the CMS cloud-gateway channel) and `@veren/im-testkit` are
deliberately not members: hub is an optional alternate channel for CMS-backed
deployments, and testkit is a vitest library that must never enter the install
closure.
`@veren/im-hub`（CMS 云网关渠道）与 `@veren/im-testkit` 刻意不是成员：hub 是面向 CMS
部署的可选替代渠道；testkit 是 vitest 库，绝不能进入安装闭包。

## Install / 安装

```bash
dsh plugin --profile web add @veren/im-bundle
```

After installing, restart the host, open the panel, and scan the QR code with
the WeChat account to authorize. Authorization secrets live in the host
credential store; rooms, messages, watermarks, and run records persist in the
`im` / `im_conversation` / `im_coordination` / `im_turn` storage domains. The
full Cumora→DSH mapping lives in `plugins/im/docs/redesign-mapping.{cn,}.md`.
安装后重启宿主，打开面板，用微信扫码完成授权。授权凭据存宿主凭据库；房间、消息、水位与
运行记录持久化在 `im` / `im_conversation` / `im_coordination` / `im_turn` 存储域。
完整 Cumora→DSH 映射见 `plugins/im/docs/redesign-mapping.{cn,}.md`。

## Data written on a real deployment / 真机部署会写什么

- `storages/im.json` — accounts, channel conversations, people, intake audit, memories
- `storages/im_conversation.json` — rooms, members, messages, counters, read cursors
- `storages/im_coordination.json` — seen watermarks
- `storages/im_turn.json` — run records, run events, agent-session map
- `storages/im_wechat.json` — WeChat channel state (cursor, contexts)
- the credential store — one record per authorized account (`im/k<hash>`)
- `%TEMP%\dsh-im-wechat-qr\` — transient QR PNGs, deleted at bind end
