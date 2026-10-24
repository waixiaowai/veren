/**
 * Public types and limits of the people directory.
 *
 * Split out of `people.ts` by responsibility so the service class, the view
 * assembly, the input hygiene, and the resolution each stay under the
 * file-size ceiling. The export surface is unchanged: `people.ts` re-exports
 * every name declared here.
 *
 * 人员目录的公开类型与限制。
 *
 * 按职责从 `people.ts` 拆出，让服务类、视图装配、输入清洗与解析各自保持在单文件行数上限内。
 * 导出面不变：`people.ts` 原样再导出这里声明的全部名字。
 *
 * @module @veren/im/people-types
 */

import type { ImPersonContact } from './contract.ts'
import type { ImLogger } from './runtime-seams.ts'
import type { ImPersonStore } from './store.ts'

/** One way a person can be reached, as the model and the user see it. */
export interface ImPersonAddressView {
  provider: string
  accountId: string
  conversationId: string
  externalId: string
  displayName?: string
}

/** How trustworthy a person's name is. */
export type ImPersonIdentityStatus = 'verified' | 'self-reported' | 'unverified'

/** One person's profile plus every reachable address. */
export interface ImPersonView {
  id: string
  displayName: string
  realName?: string
  aliases: string[]
  contacts: ImPersonContact[]
  bio?: string
  notes?: string
  /** Self-reported name; unverified and never equal to `realName`. */
  claimedName?: string
  /** Self-reported contact details; unverified. */
  claimedContacts: ImPersonContact[]
  /** When the self-report was recorded. */
  claimedAt?: number
  /**
   * Where the person's name stands: `verified` when a human recorded a real
   * name, `self-reported` when only the person's own statement exists, and
   * `unverified` otherwise.
   * 名字的可信来源：人录入了真名是 verified，只有对方自述是 self-reported，其余是 unverified。
   */
  identityStatus: ImPersonIdentityStatus
  addresses: ImPersonAddressView[]
  updatedAt: number
}

/** Which field made a person an exact match. */
export type ImPersonMatchField = 'id' | 'realName' | 'displayName' | 'alias' | 'contact' | 'address' | 'claimedName' | 'claimedContact'

/** One exact match, including the evidence a caller must show the user. */
export interface ImPersonMatch {
  person: ImPersonView
  matchedBy: ImPersonMatchField
  matchedValue: string
  /** The address that matched, when `matchedBy` is `address`. */
  address?: ImPersonAddressView
}

/** Result of resolving one user-provided name. */
export type ImPersonResolution =
  | { status: 'matched'; match: ImPersonMatch }
  | { status: 'ambiguous'; candidates: ImPersonMatch[] }
  | { status: 'not-found'; suggestions: ImPersonView[] }

/** Narrow a directory query to one provider and/or one account. */
export interface ImPersonAddressFilter {
  provider?: string
  accountId?: string
}

/** One directory listing request. */
export interface ImPersonQuery extends ImPersonAddressFilter {
  query?: string
  limit?: number
}

/** One address a caller wants to attach to a person. */
export interface ImPersonAddressInput {
  provider: string
  accountId: string
  conversationId: string
  /** Provider user id; derived from `p2p:<id>` or the conversation id when omitted. */
  externalId?: string
  /** Provider-supplied name observed at this address. */
  displayName?: string
}

/** One create-or-update request. Undefined fields are left untouched. */
export interface ImPersonSaveRequest {
  personId?: string
  address?: ImPersonAddressInput
  displayName?: string
  realName?: string
  aliases?: string[]
  contacts?: ImPersonContact[]
  bio?: string
  notes?: string
  /** Drop the unverified self-report; use after recording authoritative values. */
  clearClaim?: boolean
}

/** One self-report to record; the store adds the source and recording time. */
export interface ImPersonClaimInput {
  name?: string
  contacts?: ImPersonContact[]
  provider: string
  accountId: string
  conversationId: string
  messageId: string
}

/** Construction options; the store and clock are injectable for tests. */
export interface ImPeopleOptions {
  store: ImPersonStore
  logger: ImLogger
  newId?: (prefix: string) => string
  now?: () => number
}

/** Hard cap on exact ambiguity candidates returned by a resolution. */
export const MAX_PERSON_CANDIDATES = 20
/** Default and maximum directory listing sizes. */
export const DEFAULT_PERSON_LIMIT = 50
export const MAX_PERSON_LIMIT = 200
