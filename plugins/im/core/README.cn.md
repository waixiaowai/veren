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
- `ImPersonContact`：`kind`（`wechat` / `email` / `phone` / `other`）、`value`、`label?`
- `ImPersonView`：`id`、`displayName`、`realName?`、`aliases`、`contacts`、`bio?`、
  `notes?`、`addresses`、`updatedAt`
- `ImPersonMatch`：人员加上匹配证据（`matchedBy`、`matchedValue`）
- `ImPersonResolution`：`matched` / `ambiguous` / `not-found`
- `ImError`：`code`、可选 `providerCode`、可选 JSON-safe `details`

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

## 人与名字解析

账号是宿主已授权的通道身份；人是人。`ImAccount` 除了现场显示名之外没有任何身份信息，所以按名字
发送需要这一层独立数据：

- `im_people` 每人一份档案：`display_name`、可选 `real_name`、`aliases`（备注或其他名字）、
  `contacts`、`bio`、`notes`、`updated_at`。
- `im_person_addresses` 保存 provider 作用域的可达地址。`external_id` 是 provider 自己的用户 id；
  `conversation_id` 才是发送目标。一个人可以有多个地址（例如两个微信号）。

解析规则刻意严格：

1. 恰好一个精确匹配才发送。精确指归一化后相等（NFKC、去首尾空白、压缩空白、大小写折叠）：
   人员 id、真名、昵称、别名、联系方式（电话忽略分隔符与国家前缀）或地址。
2. 两个及以上人员精确匹配是 `IM_AMBIGUOUS`：不发送，返回候选（最多 20 个）。
3. 没有精确匹配是 `IM_NOT_FOUND`，附带最多五个相近名字；部分匹配永远不会被提升为发送。
4. 一人多名是同一个人：别名是同一个人的额外键，不是额外的人。
5. 一个人有多个可达地址同样是 `IM_AMBIGUOUS`；调用方必须用 `provider` 或 `accountId` 收窄。
6. 有档案但没有地址是 `IM_NO_ADDRESS`；只有档案不能收消息。

路由层在路由前把每个入站发送者记入目录，并在激活时用已存储的私聊会话播种。能枚举自己通讯录的
provider 可以通过 `imPeople` 服务（`ctx.imPeople.observeConversation` / `.save`）贡献地址，无需修改
`ImService`。微信 V1 无法枚举通讯录，见 `@veren/im-wechat`。

## 存储

存储域为 `im`，版本 1：

```text
im_accounts(id, provider, token_ref, owner_id)
im_conversations(account_id, conversation_id, kind, title)
im_bindings(id, account_id, conversation_id, session_id, active, settings_json)
im_people(id, display_name, real_name, aliases, contacts, bio, notes, updated_at)
im_person_addresses(person_id, provider, account_id, conversation_id, external_id, display_name, updated_at)
```

不持久化在线状态与创建时间。`token_ref` 只是凭据引用；Secret 只进 `ctx.credentials`。

## 插件

- name：`im`
- inject：`storageDomain`、`credentials`、`agents`
- provide：`im`（`ImRegistry`）、`imRouter`（`ImRouter`）与 `imPeople`（`ImPeople`）
- config：`autoCreateSession`（默认 `false`）、`replyTimeoutMs`（默认 `120000`）

DSH 会话桥以 source kind `im-message` 投递一条 `createUserMessage`，收集该 turn 的
`assistant/message` 文本，并在 `turn/end` 结算。

## 限制

- 不做消息历史、归档与全文检索。
- 不做绑定管理 UI；数据模型已允许一个 conversation 多条 binding、一个 Session 多条 binding。
- `provider` / `model` / `reasoning` 只在新建 Session 时生效，已有 Session 的切换未实现。
- 回复捕获假设同一 Session 同时只有一次被路由的 turn；路由层会按 Session 串行，但人同时在同一
  Session 的 GUI 里操作不在 V1 范围内。
- 目录只知道 provider 暴露或人录入的信息，不是全局通讯录，也不会自动跨渠道合并身份：同一个人在
  两个渠道上，需要先用 `im_person_save` 把两个地址挂到同一个人身上。

## 命令

```bash
pnpm --filter @veren/im typecheck
pnpm --filter @veren/im test
pnpm --filter @veren/im build
```
