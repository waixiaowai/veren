---
title: 邮件（Email）
description: "给每个成员一个真实邮箱：延迟铸造地址、先验签再解析、发件人归属、四层去重与写先发后的重试。"
sidebar:
  order: 12
  label: 12 邮件
draft: false
lastUpdated: 2026-11-04
---

## 12. Email

邮件是外围工作面：它不制造差异化，但它是外部世界唯一能主动敲门的入口，因此"这封信是谁发的、算不算自己人、会不会重复进两次"必须由服务端判定，而不是由界面或邮件头自己声明。本章把验签顺序、归属判定、去重层数与出站写序写得比字段清单更细。

### 12.1 Duties

| 属于本模块 | 不属于本模块 |
| --- | --- |
| 地址方案与延迟铸造（首次触达时写入） | 邮件网络投递、退信与域名信誉（上游投递方） |
| 入站验签、解析、发件人与收件人归属 | 会话与消息的序号分配（`Conversation`） |
| 线程归并：一邮件线程对应一个会话 | 对象存储、签名与授权（`Storage`） |
| 出站落库、Message-ID、幂等键与重试退避 | 推送与站内提醒（`Realtime`） |
| 附件字节落库、元数据与截断标记 | 附件对象回收（异步清理任务） |
| 外部联系人簿与往来计数 | 智能体被邮件唤醒后是否回应（`Coordination`） |

### 12.2 Capabilities

地址形如 `<参与者标识>.<工作区短名>@<域名>`，例如 `aurora.acme@cumora.ai`。用顶点域名而不是每租户子域，是为了避免"每开一个租户就要验证一次发信域"；租户隔离在收件人解析器里做，不在 DNS 里做。参与者标识里的点号在铸造时被剥掉，因此"最后一个点之后是工作区短名"这条反解永远无歧义。

关键业务规则：

- **地址延迟铸造**。第一次触达某个成员时才写入地址，靠唯一索引收敛并发；人类成员同样有自己的地址，因为投递方只能从已验证域发件，成员的真实邮箱只能作为"是否本工作区成员"的次级标识。
- **先验签原始字节，再解析**。入站入口先确认密钥已配置、签名头形状正确，然后对**原始字节**做常数时间比较，通过后才解析 JSON。顺序颠倒等于让解析器先处理未经验证的输入。
- **只有域对齐且信封与头部同址才算内部成员**。判定要求认证结论为"对齐"，且信封发件人解析后与头部发件人同址；其余任何情形——缺字段、伪造头、退信地址、冒用他人地址——一律合成外部联系人，并顺带更新联系人簿。对齐的严格定义是：只信一条来源正确的认证结果、结果词精确为通过、有 DMARC 时全部通过、无 DMARC 时 SPF 与 DKIM 都通过。
- **收件人取三者并集**：头部收件人、抄送、以及信封收件人。密送与别名转发只会出现在信封里，只看头部会漏投并让网关回一个"收件人不存在"。
- **多租户扇出**。一封邮件按租户拆成各自的会话，同租户的多个收件人合并到一个会话；附件的字节只存一份，元数据每个租户各一行。
- **四层去重**。第一层是邮件标识的唯一索引；第二层是投递前按租户预查，全部已投则整体标记为重复；第三层是回声去重——投递方会重写邮件标识，因此十分钟内方向为出站、主题与参与者集合相同的行判为自重投递；第四层是并发撞索引，按竞态处理并复用赢家行，不报错。
- **出站先落库再请求**。先把状态写成"发送中"并落库显式邮件标识，再发网络请求；反过来（先发后存）在存储失败时会让下一次唤醒重发同一封信，用户收到两封。请求携带幂等键，重复请求由投递方去重。
- **重试退避固定六档**：60 秒、5 分钟、30 分钟、2 小时、6 小时、24 小时，第六次后进入终态并告警。认领一条待重试记录时先把下次时间推后 5 分钟，避免多副本重复认领。
- **入站附件单件 10MB、总量 18MB**。超限只留元数据并标记截断，邮件正文照常投递；字节写入失败同样只标记截断并告警，不阻塞这封信进会话。
- **正文没有保留期**。清理任务只覆盖 5 张运行时表，邮件与消息不在其中——这是一个**未实现**项，长期运行会让正文表单调增长，需要单独的策略。

### 12.3 Contracts

```ts
type EmailDirection = 'in' | 'out'
type TransportStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'received'
type AuthVerdict = 'aligned' | 'unaligned' | 'unknown'

interface EmailAddress { participantId: string; companySlug: string; address: string }

interface InboundMail {
  smtpMessageId: string
  inReplyTo: string | null
  references: string[]
  from: string
  envelopeFrom: string | null
  envelopeTo: string[]
  to: string[]
  cc: string[]
  subject: string
  text: string
  html: string | null
  authVerdict: AuthVerdict
  attachments: Array<{ filename: string; mimeType: string; sizeBytes: number; truncated: boolean }>
}

interface EmailMessageRow {
  messageId: string
  conversationId: string
  direction: EmailDirection
  transportStatus: TransportStatus
  smtpMessageId: string | null
  fromAddr: string
  toAddrs: string[]
  ccAddrs: string[]
  retryAttempts: number
  nextRetryAt: string | null
}

interface IngestResult { delivered: boolean; deduplicated: boolean; conversationIds: string[] }
interface SendResult { ok: boolean; smtpMessageId: string | null; error: string | null; mock: boolean }

abstract class EmailService {
  abstract mintAddress(participantId: string, companyId: string): Promise<string>
  abstract ingest(rawBytes: Uint8Array, signature: string): Promise<IngestResult>
  abstract reply(conversationId: string, actorId: string, body: string): Promise<EmailMessageRow>
  abstract retryDue(limit: number): Promise<number>
}
```

错误约定：验签失败返回 `401 EMAIL_SIGNATURE_INVALID` 且不解析正文；解析通过但没有任何可归属收件人返回 `404 EMAIL_NO_RECIPIENT`（网关据此回退信）；同一邮件重复投递返回 `200` 与 `deduplicated: true`；发送方限流或网络错误不向回信调用方冒泡，只落 `failed` 并排入退避。稳定码清单见 [错误码与状态模型](../errors/)。

### 12.4 Flow

```ts
async function ingest(deps: EmailDeps, rawBytes: Uint8Array, signature: string): Promise<IngestResult> {
  // 1) 先验签，后解析：未通过签名的字节不进入任何解析器
  const verdict = deps.signature.verify(rawBytes, signature)      // 常数时间比较
  if (!verdict.ok) throw new EmailError('EMAIL_SIGNATURE_INVALID')

  const mail: InboundMail = JSON.parse(decodeUtf8(rawBytes))
  const sender = await deps.identity.resolveSender(mail)          // 内部成员或合成外部联系人
  const recipients = await deps.identity.resolveRecipients([...mail.to, ...mail.cc, ...mail.envelopeTo])
  if (recipients.length === 0) throw new EmailError('EMAIL_NO_RECIPIENT')

  // 2) 预查去重：同一租户已投过这一封就不再写第二遍
  const pending = await deps.db.filterUndelivered(mail.smtpMessageId, recipients)
  if (pending.length === 0) return { delivered: false, deduplicated: true, conversationIds: [] }

  const conversationIds: string[] = []
  for (const group of groupByCompany(pending)) {
    const conversation = await deps.conversations.findOrCreate(mail, group)   // 按回复链与引用链归并
    try {
      await deps.db.insertInbound(conversation, mail, sender, group)          // 消息、邮件行、附件元数据同事务
      conversationIds.push(conversation.id)
    } catch (error) {
      if (!deps.db.isUniqueViolation(error)) throw error                      // 竞态以外照常上抛
      await deps.conversations.reuseWinner(mail, group)                       // 并发撞索引：复用赢家行
    }
    await deps.realtime.enqueue('conversation.updated', { conversationId: conversation.id })
  }
  return { delivered: true, deduplicated: false, conversationIds }
}
```

分支说明：验签失败直接 `401`，正文不会被解析，也不写任何行；归属为外部发件人时不唤醒任何智能体，只把它记成外部联系人；`resolveRecipients` 只看头部会漏密送，因此三个来源都参与；`findOrCreate` 命中不到回复链时新建会话，若后续写入失败必须清理这个"幽灵会话"，否则列表里会留下空线程；唯一索引冲突是并发重复投递的正常结局，按竞态复用赢家而不是回错误。

### 12.5 Recovery and Idempotency

| 风险 | 机制 | 恢复方式 |
| --- | --- | --- |
| 同一封信重复投递 | 唯一索引 + 投递前预查 + 回声去重 + 竞态复用 | 第二次返回 `deduplicated: true`，会话里只有一条消息 |
| 发送成功但状态未写回 | `sending` 行保留，`Message-ID` 已落库 | 重试任务接管；同一标识重发由投递方幂等去重，不产生第二封 |
| 进程在请求前崩溃 | 先落库后请求的顺序 | 重启后该行仍是 `sending`，按待重试处理；不会出现"发出去了但系统不知道" |
| 重试到终态 | 六档退避后清空下次时间 | 写入终态并告警（包含"消息可能已丢失"字样），不再自动重试，交人工判断 |
| 附件字节丢失 | 单件与总量上限，超限只留元数据 | 邮件仍可读，附件标为截断；写入失败额外告警并计数 |
| 幽灵会话 | 会话创建与消息写入分离 | 写入失败即回滚并删除刚建的会话，列表不出现空线程 |
| 正文无保留期 | 无（**未实现**） | 目前只能靠人工归档；这是已知缺口，需要独立的保留策略 |

### 12.6 Acceptance

| 编号 | 前置 | 操作 | 可观察结果 |
| --- | --- | --- | --- |
| EM-01 | 攻击者构造一封信并伪造签名头 | 投递到入站入口 | 返回 `401 EMAIL_SIGNATURE_INVALID`，不创建消息、不创建会话、无附件对象 |
| EM-02 | 头部发件人写成本工作区某智能体，信封发件人是外部地址 | 投递 | 不唤醒该智能体；消息作者是外部联系人，联系人簿出现该地址 |
| EM-03 | 同一封信被网关重投两次 | 连续投递 | 第二次返回 `deduplicated: true`，会话中只有一条消息、一个邮件行 |
| EM-04 | 一封外站邮件同时出现在收件人与抄送，且被密送 | 投递 | 收件人、抄送与密送三个地址都被解析出成员；同租户合并到一个会话，没有"收件人不存在"的退信 |
| EM-05 | 附件合计 20MB | 投递 | 邮件进入会话，附件只有元数据且标记截断，正文完整 |
| EM-06 | 出站请求超时但投递方已受理 | 重试同一封回复 | 供应商按幂等键去重，收件人只收到一封，本地只有一条 `sent` 行 |
