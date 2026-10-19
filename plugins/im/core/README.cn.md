# @veren/im

DeepSeek Harness 的渠道无关 IM 契约、注册表、存储与 active-binding 路由。

## 什么时候使用

当 DSH 宿主需要把账号、会话、绑定、入站路由与显式发送目标抽象成一套 IM 能力时使用本包。它是核心包，
不是渠道实现，也不是工具层。

不要在这里添加渠道特判。具体渠道放在自己的 provider 包里（本仓库为 `@veren/im-wechat`），
以单个 `ImProvider` 注册。

## 包集合

| 包 | 职责 |
|---|---|
| `@veren/im` | 契约、`ImRegistry`、`ImError`、存储、路由、DSH Session 桥 |
| `@veren/im-tool` | 面向模型的 `im_*` 工具 |
| `@veren/im-wechat` | 微信 iLink provider |
| `@veren/im-testkit` | 假 provider 与可复用契约测试套件 |

## 契约

契约以源码为准：

- `ImAccount`：`id`、`displayName`、`ownerId?`、`status`
- `ImConversation`：`id`、`kind`（`direct` / `group` / `thread`）、`title?`
- `ImMessage`：`id`、`accountId`、`conversationId`、`sender`、`sentAt`、
  `content`、`replyTo?`、`threadId?`
- `ImMessageContent`：`text`、`markdown`、`image`、`file`
- `ImFeatures`：direct/group/threads/markdown/media/typing/auth/limits
- `ImBindRequest`：按 `method` 区分的联合类型，没有通用 options 口袋
- `ImBindAttempt`：`bindId`、`status`、`challenge`、`submitCode`、`wait`、`cancel`
- `ImSendRequest`：显式 `target`、`content`、可选 `replyToMessageId`
- `ImSendResult`：`id`、`sentAt`、`uncertain?`
- `ImBinding`：`id`、`accountId`、`conversationId`、`sessionId`、`active`、`settings`
- `ImBindingSettings`：`presetId`、`provider`、`model`、`reasoning`
- `ImError`：`code` 与可选 `providerCode`

`ImService` 只有 `start`、`stop`、`accounts`、`listen`、`bind`、`send`。
provider 身份与能力放在 `ImProvider` 描述符上（`id`、`displayName`、`features`、`service`）。

`ImRegistry` 只有 `register`、`get`、`list`；`get` 找不到时抛 `IM_NOT_FOUND`。
所有注册都通过注册方 fiber 的 effect 逆序清理。

## 路由规则

1. 入站消息按 `(accountId, conversationId)` 找 active binding。
2. 没有 active binding 时，由 `autoCreateSession` 决定：新建 Session 与 active binding，或记日志忽略。
3. 来源元数据与消息正文渲染成两个独立区块；正文是不可信输入。
4. 同一 conversation 的消息串行处理。
5. 答案回到产生本次 turn 的精确 conversation，绝不按“当前 active binding”猜。
6. 激活一条 binding 时，在同一串行写里把该 conversation 的其他 active binding 关掉。

## 存储

存储域为 `im`，版本 1：

```text
im_accounts(id, provider, token_ref, owner_id)
im_conversations(account_id, conversation_id, kind, title)
im_bindings(id, account_id, conversation_id, session_id, active, settings_json)
```

不持久化在线状态与创建时间。`token_ref` 只是凭据引用；Secret 只进 `ctx.credentials`。

## 插件

- name：`im`
- inject：`storageDomain`、`credentials`、`agents`
- provide：`im`（`ImRegistry`）与 `imRouter`（`ImRouter`）
- config：`autoCreateSession`（默认 `false`）、`replyTimeoutMs`（默认 `120000`）

DSH 会话桥以 source kind `im-message` 投递一条 `createUserMessage`，收集该 turn 的
`assistant/message` 文本，并在 `turn/end` 结算。

## 限制

- 不做消息历史、归档与全文检索。
- 不做绑定管理 UI；数据模型已允许一个 conversation 多条 binding、一个 Session 多条 binding。
- `provider` / `model` / `reasoning` 只在新建 Session 时生效，已有 Session 的切换未实现。
- 回复捕获假设同一 Session 同时只有一次被路由的 turn；路由层会按 Session 串行，但人同时在同一
  Session 的 GUI 里操作不在 V1 范围内。

## 命令

```bash
pnpm --filter @veren/im typecheck
pnpm --filter @veren/im test
pnpm --filter @veren/im build
```
