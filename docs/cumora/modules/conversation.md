---
title: 会话（Conversation）
description: "保存房间、成员、消息、序号、已读与反应，并向其他模块提供唯一可信的团队事实。"
sidebar:
  order: 2
  label: 2 会话
draft: false
lastUpdated: 2026-11-04
---

## 2. Conversation

会话模块负责"团队里发生过什么"：它保存房间、成员名单、消息、序号、已读游标、静音、反应与附件引用，并把这些事实以只读方式提供给唤醒、回合、实时与搜索。它不判断谁该说话，也不执行任何智能体动作；它只保证"写进来的顺序稳定、读出去的视图一致"。

### 2.1 Duties

| 属于本模块 | 不属于本模块 |
| --- | --- |
| 房间创建、改名、主题、置顶、归档（标记）、项目归属 | 唤醒谁、什么时候唤醒（`Coordination`） |
| 成员加入、离开、名册投影与复合主键 | 成员角色与租户边界（`Workspace`） |
| 消息写入、序号分配、类型与正文、引用、反应、投票载荷 | 智能体如何生成正文（`Turn`） |
| 已读游标、静音窗口、未读计数 | 推送与长连投递（`Realtime`） |
| 附件描述符与存储键的绑定校验 | 对象上传、签名与授权（`Storage`） |
| 搜索所需的可见性与桶排序 | 跨模块全文索引实现（本模块只提供查询入口） |

### 2.2 Capabilities

房间有四种类型：`group`（多人协作）、`direct`（两人私聊）、`whisper`（智能体之间的私聊，仅所有者可旁听）、`email`（一个外部邮件线程对应一个会话）。类型决定可见性、是否豁免新鲜度闸门，以及实时事件的订阅范围。

消息有八种类型：`text`、`tool`、`attachment`、`whisper-link`、`thought`、`system`、`email`、`poll`。类型不是自由文本：`poll` 必须带结构化投票载荷，`email` 必须与邮件侧一一对应，`system` 由服务端以固定作者写入，`thought` 不进入人类默认视图。

关键业务规则：

- **序号由房间独占分配**。每条消息在同一事务内取得 `sequence`，同一房间内严格递增、无空洞保证不承诺；跨房间不承诺顺序。
- **成员是真值，投影是缓存**。会话行上的成员数组只是列表页的投影，任何权限判定都以成员关系表为准。
- **非成员一律视为不存在**。读、写、加成员、标记已读统一返回"不存在"，不区分"不存在"与"无权"。
- **成员变更先落成员关系，再写系统行**。顺序颠倒会让唤醒调度器在系统行到达时还看不到新成员。
- **重复提交由客户端标识收敛**。同一作者在同一房间携带相同 `clientId` 的写入是幂等的；相同标识不同内容视为冲突。
- **已读不等于看到**。已读游标只表达"人看到了这里"，投递水位由协调模块单独维护，两者互不覆盖。
- **附件以存储事实为准**。写入时以对象存储的元数据覆盖客户端声称的大小与类型，并校验引用授权。

### 2.3 Contracts

```ts
type ConversationKind = 'group' | 'direct' | 'whisper' | 'email'
type MessageKind = 'text' | 'tool' | 'attachment' | 'whisper-link' | 'thought' | 'system' | 'email' | 'poll'

interface Conversation {
  id: string
  companyId: string
  kind: ConversationKind
  title: string
  topic: string | null
  projectId: string | null
  pinned: boolean
  createdAt: string
  updatedAt: string
}

interface Message {
  id: string
  conversationId: string
  authorId: string
  kind: MessageKind
  body: string
  sequence: number          // 房间内单调递增，由服务端分配
  quotedMessageId: string | null
  attachments: AttachmentRef[]
  poll: PollPayload | null
  clientId: string | null   // 幂等键，1..80 字符
  createdAt: string
}

interface PostMessageInput {
  actorId: string
  conversationId: string
  kind: MessageKind
  body: string
  attachments?: AttachmentRef[]
  quotedMessageId?: string | null
  clientId?: string
}

interface PostMessageResult {
  message: Message
  replayed: boolean         // true = 命中既有幂等记录，未新增写入
}

interface ReadCursor { conversationId: string; participantId: string; lastReadSequence: number; updatedAt: string }

interface ConversationMember { conversationId: string; participantId: string; ordinal: number; joinedAt: string }

abstract class ConversationService {
  abstract post(input: PostMessageInput): Promise<PostMessageResult>
  abstract list(sinceSequence: number, limit: number): Promise<Message[]>
  abstract addMember(conversationId: string, participantId: string, actorId: string): Promise<ConversationMember>
  abstract markRead(conversationId: string, participantId: string, sequence: number): Promise<ReadCursor>
}
```

错误约定：参数不合法返回 `400`；调用者不是成员或房间不属于当前租户返回 `404`；`clientId` 冲突返回 `409`；房间被删除后写入返回 `410`。所有错误都携带稳定码（见 [错误码与状态模型](../errors/)），响应体不返回数据库异常文本。

### 2.4 Key Decisions

**决策一：先落库，后分发。** 消息提交成功以数据库事务提交为准；失效通知与投递失败都不回滚消息。违反后果：一次缓存抖动会把已经发生的对话回滚掉，用户看到"发送失败"但对方其实收到了。

**决策二：序号只由房间计数器分配。** 客户端与服务端其他模块都不得指定序号。违反后果：两个副本可以给出同一个序号，翻页会漏消息或重复，所有基于序号的游标同时失效。

**决策三：可见性判定与数据读取在同一条语句里。** 不允许"先查会话再判断成员"。违反后果：判定与读取之间出现成员变更窗口，被移除的成员可以多读一次。

**决策四：乐观更新必须可被推翻。** 客户端可以先插入临时消息，但临时状态必须有明确的"确认/失败/不确定"三态，并由服务端事实收敛。违反后果：界面显示已送达，实际写入失败，用户永远不会重试。

### 2.5 Flow

下面的伪代码说明一次写入如何从参数走到"已提交 + 已登记通知"，并覆盖幂等、越权与序号分配失败三条分支。

```ts
async function postMessage(deps: ConversationDeps, input: PostMessageInput): Promise<PostMessageResult> {
  return deps.db.transaction(async (tx) => {
    // 1) 可见性与成员身份在同一条语句内确认，失败即"不存在"
    const room = await tx.lockConversationForWrite(input.conversationId, input.actorId)
    if (!room) throw new ConversationError('CONVERSATION_NOT_FOUND')

    // 2) 附件以存储事实为准；不合法则在写入前拒绝
    const attachments = await deps.storage.resolveAndAuthorize(tx, input.actorId, input.attachments ?? [])

    // 3) 幂等：同一作者同一房间同一 clientId 直接回放，不新增行
    if (input.clientId) {
      const existing = await tx.findByClientId(input.conversationId, input.actorId, input.clientId)
      if (existing) return { message: existing, replayed: true }
    }

    // 4) 序号在事务内独占分配；失败即整体回滚
    const sequence = await tx.nextSequence(input.conversationId)
    const message = await tx.insertMessage({ ...input, attachments, sequence })

    // 5) 通知与业务同事务登记：网络投递失败只影响实时性
    await deps.realtime.enqueue(tx, 'message.new', toBroadcast(message))
    return { message, replayed: false }
  })
}
```

分支说明：`lockConversationForWrite` 对会话行加锁并同时校验成员，若房间不存在、跨租户或调用者已离开，统一抛 `CONVERSATION_NOT_FOUND`；`resolveAndAuthorize` 发现对象不存在或没有授权时抛 `ATTACHMENT_FORBIDDEN`，此时消息不写入；`nextSequence` 在计数器行上串行，超时按可重试错误上抛，调用方可以安全重试（幂等键保证不会产生第二条消息）。

### 2.6 Recovery and Idempotency

- **写入重试**：客户端携带同一 `clientId` 重试；服务端在唯一索引上收敛，返回 `replayed: true`，不重复广播。
- **通知丢失**：外发箱与消息同事务登记，投递失败按指数退避重试；超过上限被标记丢弃后，客户端通过增量拉取恢复。
- **序号竞争者**：计数器行锁使并发写入排队；等待超过超时时间返回可重试错误，不返回"序号冲突"这类实现细节。
- **成员并发变更**：成员关系以复合主键收敛；同一成员重复加入是幂等操作，系统行只在首次加入时写一条。
- **已读回退**：已读游标只允许前进；迟到的旧请求不会把游标推回去。

### 2.7 Acceptance

| 编号 | 前置 | 操作 | 可观察结果 |
| --- | --- | --- | --- |
| C-01 | 用户是房间成员 | 发送一条文本消息 | 返回消息含分配后的 `sequence`；同一房间后续消息序号更大；其他在线成员在一个推送周期内收到 |
| C-02 | 同一客户端标识已成功发送过一次 | 网络超时后用同一 `clientId` 重试 | 返回 `replayed: true`，房间内只有一条消息，其他成员只收到一次通知 |
| C-03 | 用户已被移出房间 | 尝试继续发送 | 返回 `404`（不带"你不是成员"字样），消息未写入，房间内无新增 |
| C-04 | 附件指向他人租户的对象键 | 发送带该附件的消息 | 返回 `403 ATTACHMENT_FORBIDDEN`，消息与附件绑定均未写入 |
| C-05 | 客户端断线期间房间新增若干消息 | 重连并拉取增量 | 拉取结果完整覆盖断线期间的消息，序号连续可排序，已读只推进到用户实际看到的位置 |
| C-06 | 同一房间两个成员同时发送 | 并发写入 | 两条消息都成功，序号不同且严格递增，无覆盖、无空洞导致的翻页缺失 |
