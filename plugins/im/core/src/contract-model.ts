/**
 * Provider-neutral data model of the IM contract: accounts, conversations,
 * contacts, self-reported claims, messages, and content blocks.
 *
 * Split out of `contract.ts` so the error class, service behavior, and the
 * registry each stay under the file-size ceiling; the export surface is
 * unchanged — `contract.ts` re-exports every name declared here.
 *
 * IM 契约的渠道无关数据模型：账号、会话、联系方式、自述、消息与内容块。
 *
 * 按职责从 `contract.ts` 拆出，让错误类、服务行为与注册表各自保持在单文件行数上限内；导出面
 * 不变——`contract.ts` 原样再导出这里声明的全部名字。
 *
 * @module @veren/im/contract-model
 */

/**
 * One contact method stored on a person record.
 *
 * This is identity data a human gave us (WeChat id, email, phone, or another
 * handle); it is searchable and shown back to the model, but only a provider
 * address can actually receive a message.
 * 人员记录上的一种联系方式。
 *
 * 这是人提供的身份信息（微信号、邮箱、电话或其他账号），可搜索、会展示给模型；但真正能收消息的
 * 只有 provider 地址。
 */
export interface ImPersonContact {
  kind: 'wechat' | 'email' | 'phone' | 'other'
  value: string
  /** Optional qualifier, for example "工作" / "personal". */
  label?: string
}

/**
 * One identity statement a person made about themselves.
 *
 * A claim is evidence, never verification: it lives beside `realName`,
 * `displayName`, `aliases`, and `contacts`, which only a human (through
 * `im_person_save`) or a provider profile may set. Sending by a claimed name is
 * reported as `matchedBy: 'claimedName'`; a claimed name that collides with
 * another person stays ambiguous and is never silently chosen.
 * 一个人对自己身份的自述。
 *
 * 自述只是证据，不是核实：它与 realName、displayName、aliases、contacts 并列保存，后者只能由人
 * （通过 im_person_save）或 provider 档案设置。按自述名发送会以 matchedBy: 'claimedName' 报告依据；
 * 与其他人重名时保持歧义，绝不静默选中。
 */
export interface ImPersonClaim {
  /** The name the person used for themselves; unverified. */
  name?: string
  /** Contact details the person offered; unverified. */
  contacts: ImPersonContact[]
  /** Where the claim came from. V1 records one provider self-report. */
  source: 'self-report'
  /** Provider whose conversation produced the claim. */
  provider: string
  /** Account that received the claim. */
  accountId: string
  /** Conversation the claim arrived in. */
  conversationId: string
  /** Inbound message the claim was read from. */
  messageId: string
  /** Epoch milliseconds when the claim was recorded. */
  at: number
}

/** One reachable identity inside a provider. */
export interface ImAccount {
  /** Stable provider-scoped account id. */
  id: string
  /** Human-readable account name. */
  displayName: string
  /** The human who authorized this account, when known. */
  ownerId?: string
  /** Live connection status; never persisted. */
  status: 'online' | 'offline' | 'error'
}

/** One addressable conversation inside an account. */
export interface ImConversation {
  /** Provider-scoped opaque conversation id. */
  id: string
  /** Conversation kind. */
  kind: 'direct' | 'group' | 'thread'
  /** Optional human-readable title. */
  title?: string
}

/** One account as a listing renders it, with the owning provider id. */
export interface ImAccountView extends ImAccount {
  provider: string
}

/** One conversation as a listing renders it, with its account. */
export interface ImConversationView extends ImConversation {
  accountId: string
}

/** One message participant. */
export interface ImUser {
  /** Provider-scoped opaque user id. */
  id: string
  /** Optional display name. */
  name?: string
}

/**
 * One normalized content block.
 *
 * V1 WeChat produces and consumes text only; the other variants are the
 * extension point for providers that can carry richer content.
 */
export type ImMessageContent =
  | { type: 'text'; text: string }
  | { type: 'markdown'; text: string }
  | { type: 'image'; mime: string; name?: string; size?: number; load(): Promise<Buffer> }
  | { type: 'file'; mime: string; name: string; size?: number; load(): Promise<Buffer> }

/** One normalized inbound message. */
export interface ImMessage {
  /** Provider-stable message id, used for deduplication. */
  id: string
  /** Account that received the message. */
  accountId: string
  /** Conversation the message belongs to. */
  conversationId: string
  /** Who sent it. */
  sender: ImUser
  /** Epoch milliseconds at the provider. */
  sentAt: number
  /** Normalized content. */
  content: ImMessageContent
  /** Message id this message replies to, when the provider exposes it. */
  replyTo?: string
  /** Thread id, when the provider has native threads. */
  threadId?: string
}
