/**
 * Public types of the active-binding router: configuration, construction
 * options, and the person-targeted send/save shapes.
 *
 * Split out of `router.ts` so the facade class stays under the file-size
 * ceiling; the export surface is unchanged — `router.ts` re-exports every name
 * declared here.
 *
 * active-binding 路由的公开类型：配置、构造选项与按人发送/保存的请求与结果形状。
 *
 * 按职责从 `router.ts` 拆出，让门面类保持在单文件行数上限内；导出面不变——`router.ts`
 * 原样再导出这里声明的全部名字。
 *
 * @module @veren/im/router-types
 */

import type { ImMessageContent, ImPersonContact, ImSendResult } from './contract.ts'
import type { ImStrangerIntakeConfig } from './intake.ts'
import type {
  ImPersonIdentityStatus, ImPersonMatchField,
} from './people-types.ts'
import type { ImBindingsOptions } from './bindings.ts'
import type { ImCredentialStore } from './runtime-seams.ts'
import type { ImPeople } from './people.ts'
import type { ImBindingStore, ImPersonStore } from './store.ts'

/** One account removal result. */
export interface ImUnbindAccountResult {
  removed: boolean
  revoked: boolean
  warning?: string
}

/** Router configuration. */
export interface ImRouterConfig {
  /** Create a Session and an active binding when an inbound conversation has none. */
  autoCreateSession: boolean
  /**
   * Automatic stranger-intake question. Omitted means disabled: a router built
   * without this option sends no unsolicited question.
   * 自动陌生人询问。省略即关闭：未提供此选项的 router 不会主动发问。
   */
  strangerIntake?: ImStrangerIntakeConfig
}

/** Router construction options. */
export interface ImRouterOptions extends ImBindingsOptions {
  /**
   * The router touches people rows too (startup account reconciliation), so
   * its store carries both seams; the binding seam alone is not enough.
   * 路由层也要碰人员表（启动账号对账），因此它的存储同时携带两条接缝；仅绑定接缝不够。
   */
  store: ImBindingStore & ImPersonStore
  credentials: ImCredentialStore
  /** Durable, provider-neutral people directory. */
  people: ImPeople
  config: ImRouterConfig
  /** Clock for intake windows and rate limits; defaults to `Date.now`. */
  now?: () => number
}

/** One person-targeted send request; the target is a person, not an address. */
export interface ImPersonSendRequest {
  /** Person id, or any exact name, alias, contact, or address. */
  person: string
  /** Restrict reachable addresses to one provider, for example `wechat`. */
  provider?: string
  /** Restrict reachable addresses to one account. */
  accountId?: string
  content: ImMessageContent
  replyToMessageId?: string
}

/** The exact recipient a person-targeted send resolved to. */
export interface ImPersonRecipient {
  personId: string
  displayName: string
  matchedBy: ImPersonMatchField
  matchedValue: string
  /** Whether the matched name is verified, self-reported, or unverified. */
  identityStatus: ImPersonIdentityStatus
  /** Present when the person has a self-reported name. */
  claimedName?: string
  provider: string
  accountId: string
  conversationId: string
}

/** One person-targeted send result, including the evidence shown to the user. */
export interface ImPersonSendResult {
  result: ImSendResult
  recipient: ImPersonRecipient
}

/** One directory write; the account's provider fills in a missing provider. */
export interface ImPersonSaveInput {
  personId?: string
  address?: {
    accountId: string
    conversationId: string
    provider?: string
    externalId?: string
    displayName?: string
  }
  displayName?: string
  realName?: string
  aliases?: string[]
  contacts?: ImPersonContact[]
  bio?: string
  notes?: string
  /** Drop the unverified self-report; use after recording authoritative values. */
  clearClaim?: boolean
}
