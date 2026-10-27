/**
 * The people directory: identity records plus name resolution for outbound
 * sends.
 *
 * A person is a human, not an account. One person owns one profile (nickname,
 * real name, aliases/remarks, contact methods, bio) and zero or more provider
 * addresses. Only an address can receive a message; a profile alone cannot.
 *
 * Resolution is deliberately strict: one exact match sends, zero matches return
 * suggestions, and two or more matches are `IM_AMBIGUOUS`. Partial matches are
 * never promoted to a send. This layer answers "who did the user mean", not
 * "who looks closest".
 *
 * 人员目录：身份记录与发送目标的名字解析。
 *
 * 人是人，不是账号。一个人拥有一份档案（昵称、真名、别名/备注、联系方式、简介）和零个或多个
 * provider 地址。只有地址能收消息，只有档案不能。
 *
 * 解析刻意严格：恰好一个精确匹配才发送，零个匹配返回相近候选，两个及以上是 `IM_AMBIGUOUS`。
 * 部分匹配永远不会被提升为发送。这一层回答「用户指的是谁」，而不是「谁看起来最像」。
 *
 * This file keeps the public face: the service class, its token, and the
 * unchanged re-export surface. By responsibility the module is split into
 * `people-types.ts` (types and limits), `people-text.ts` (input hygiene),
 * `people-view.ts` (view assembly), `people-resolve.ts` (strict resolution),
 * and `people-writes.ts` (the serialized write path).
 *
 * 本文件保留公开门面：服务类、服务令牌与原样不变的再导出面。模块按职责拆为
 * `people-types.ts`（类型与限制）、`people-text.ts`（输入清洗）、`people-view.ts`（视图装配）、
 * `people-resolve.ts`（严格解析）与 `people-writes.ts`（串行写路径）。
 *
 * @module @veren/im/people
 */

import { defineToken } from '@veren/core'
import { ImError } from './contract.ts'
import type { ImDirectorySnapshot, ImMessage } from './contract.ts'
import { capCandidates, exactMatch, keepBestMatch, suggestions } from './people-resolve.ts'
import {
  addressMatches, byName, clampLimit, hasFilter, matchesQuery, toAddressView, viewOf, withFilteredAddresses,
} from './people-view.ts'
import { normalizeText } from './people-text.ts'
import { PeopleMutations } from './people-writes.ts'
import type {
  ImPeopleOptions, ImPersonAddressFilter, ImPersonAddressInput, ImPersonAddressView, ImPersonClaimInput,
  ImPersonMatch, ImPersonQuery, ImPersonResolution, ImPersonSaveRequest, ImPersonView,
} from './people-types.ts'
import type { ImPersonIntakeRow, ImPersonAddressRow, ImPersonStore } from './store.ts'

// ---- unchanged export surface (re-exported from the split modules) ----
// ---- 导出面不变（由拆分出的模块原样再导出）----
export {
  DEFAULT_PERSON_LIMIT, MAX_PERSON_CANDIDATES, MAX_PERSON_LIMIT,
} from './people-types.ts'
export type {
  ImPeopleOptions,
  ImPersonAddressFilter,
  ImPersonAddressInput,
  ImPersonAddressView,
  ImPersonClaimInput,
  ImPersonIdentityStatus,
  ImPersonMatch,
  ImPersonMatchField,
  ImPersonQuery,
  ImPersonResolution,
  ImPersonSaveRequest,
  ImPersonView,
} from './people-types.ts'

/** The `imPeople` service token. */
const ImPeopleToken = defineToken<ImPeople>('imPeople')
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** People directory, provided by @veren/im. */
    imPeople: ImPeople
  }
}
export { ImPeopleToken }

/**
 * People directory: persistence-facing read/write operations plus strict name
 * resolution. It never sends; the router owns that step.
 *
 * Reads run directly against the store; every mutation is delegated to
 * {@link PeopleMutations}, which serializes them on one write chain.
 *
 * 人员目录：面向持久化的读写操作与严格名字解析。它从不发送；发送由路由层负责。
 *
 * 读直接走存储；所有变更都委托给 {@link PeopleMutations}，由它在一条写链上串行执行。
 */
export class ImPeople {
  private readonly store: ImPersonStore
  private readonly mutations: PeopleMutations

  constructor(options: ImPeopleOptions) {
    this.store = options.store
    this.mutations = new PeopleMutations(options)
  }

  /** List or search people; a search is substring-only and never sends. */
  list(request: ImPersonQuery = {}): ImPersonView[] {
    const filter: ImPersonAddressFilter = {
      ...(request.provider === undefined ? {} : { provider: request.provider }),
      ...(request.accountId === undefined ? {} : { accountId: request.accountId }),
    }
    const raw = request.query?.trim()
    const query = raw === undefined || raw === '' ? undefined : normalizeText(raw)
    return this.views()
      .map(view => withFilteredAddresses(view, filter))
      .filter(view => !hasFilter(filter) || view.addresses.length > 0)
      .filter(view => query === undefined || matchesQuery(view, query))
      .sort(byName)
      .slice(0, clampLimit(request.limit))
  }

  /** Resolve one exact name, alias, contact, id, or address. */
  resolve(query: string, filter: ImPersonAddressFilter = {}): ImPersonResolution {
    const raw = query.trim()
    const normalized = normalizeText(raw)
    if (raw === '') throw new ImError('IM_INVALID_REQUEST', 'person query is required')
    // One directory read serves both the match loop and the suggestion pool.
    // 一次目录读取同时服务匹配循环与建议池。
    const views = this.views()
    const matches = new Map<string, ImPersonMatch>()
    for (const view of views) {
      const match = exactMatch(view, raw, normalized)
      if (match === undefined) continue
      matches.set(view.id, keepBestMatch(matches.get(view.id), match))
    }
    const candidates = capCandidates([...matches.values()])
    if (candidates.length === 1) return { status: 'matched', match: candidates[0]! }
    if (candidates.length > 1) return { status: 'ambiguous', candidates }
    const pool = views
      .map(view => withFilteredAddresses(view, filter))
      .filter(view => !hasFilter(filter) || view.addresses.length > 0)
    return { status: 'not-found', suggestions: suggestions(normalized, pool) }
  }

  /** Read every address of one person, narrowed by an optional filter. */
  addressesOf(personId: string, filter: ImPersonAddressFilter = {}): ImPersonAddressView[] {
    return this.store.personAddresses()
      .filter(row => row.person_id === personId && addressMatches(row, filter))
      .map(toAddressView)
  }

  /** The person observed at one exact conversation, when known. */
  viewAt(provider: string, accountId: string, conversationId: string): ImPersonView | undefined {
    const rows = this.store.personAddresses()
    const address = rows.find(row => row.provider === provider
      && row.account_id === accountId
      && (row.conversation_id === conversationId || row.external_id === conversationId))
    if (address === undefined) return undefined
    const person = this.store.getPerson(address.person_id)
    if (person === undefined) return undefined
    return viewOf(person, rows.filter(row => row.person_id === person.id))
  }

  /** Register the sender of one inbound message and return their person. */
  observeMessage(providerId: string, message: ImMessage): Promise<ImPersonView | undefined> {
    return this.mutations.observeMessage(providerId, message)
  }

  /**
   * Adopt a cloud directory snapshot into the local cache: only entries on the
   * device's own channel are imported (the identity of a person observed by
   * another provider stays hub-only), and the display name rides the same
   * idempotent observe path — nothing is force-overwritten.
   * 把云端目录快照采纳进本地缓存：只导入本设备通道的条目（别的 provider 观察到的人
   * 仍只归云），显示名走同一条幂等观察路径——不强行覆盖任何本地值。
   */
  async adoptRemote(snapshot: ImDirectorySnapshot, channel: { provider: string; accountId: string }): Promise<number> {
    const byId = new Map(snapshot.people.map(person => [person.id, person]))
    let adopted = 0
    for (const [personId, addresses] of Object.entries(snapshot.addresses)) {
      const person = byId.get(personId)
      if (person === undefined) continue
      for (const address of addresses) {
        if (address.provider !== channel.provider) continue
        const view = await this.mutations.observeConversation({
          provider: address.provider,
          accountId: channel.accountId,
          conversationId: `p2p:${address.external_id}`,
          externalId: address.external_id,
          displayName: person.display_name !== '' ? person.display_name : address.display_name,
        })
        // 原 id 显示名不是人工编辑：云端的策展名可以覆盖它（本设备陈旧缓存升级，
        // 真机反例 2026-10-27：导入后本地仍显示原 id）。人工改过的名字不动。
        // A raw-id display is not a human edit: the curated cloud name may
        // replace it (stale local cache, live counter-example 2026-10-27). A
        // manually renamed display is left alone.
        if (view.displayName === address.external_id
          && person.display_name !== ''
          && person.display_name !== view.displayName) {
          await this.mutations.save({ personId: view.id, displayName: person.display_name })
        }
        adopted += 1
      }
    }
    return adopted
  }

  /**
   * Register one provider address. Idempotent: the same provider user id always
   * updates the same person instead of creating a duplicate.
   * 登记一个 provider 地址。幂等：同一个 provider 用户 id 永远更新同一个人，不会创建重复记录。
   */
  observeConversation(input: ImPersonAddressInput): Promise<ImPersonView> {
    return this.mutations.observeConversation(input)
  }

  /**
   * Create a person from an address, or enrich an existing person.
   *
   * An address already owned by a different person is rejected: silently
   * stealing it would make two humans share one destination.
   * 从地址创建人员，或补充已有人员。地址已属于另一个人时拒绝：静默抢占会让两个人共用一个目的地。
   */
  save(request: ImPersonSaveRequest): Promise<ImPersonView> {
    return this.mutations.save(request)
  }

  /**
   * Record one unverified self-report on a person. Authoritative fields are
   * never touched, and the first report wins: a later observation cannot
   * rewrite what the person said about themselves.
   * 在一个人身上记录一条未核实自述。权威字段永不被改动，且第一条自述生效：之后的观察不能
   * 改写对方说过的身份。
   */
  recordClaim(personId: string, input: ImPersonClaimInput): Promise<ImPersonView> {
    return this.mutations.recordClaim(personId, input)
  }

  /** Read one person by id, when present. */
  person(personId: string): ImPersonView | undefined {
    const row = this.store.getPerson(personId)
    if (row === undefined) return undefined
    return viewOf(row, this.store.personAddresses().filter(address => address.person_id === personId))
  }

  /** Read one person's automatic-intake record, when they were asked. */
  intakeOf(personId: string): ImPersonIntakeRow | undefined {
    return this.store.getIntake(personId)
  }

  /** Read every automatic-intake record, for the audit view. */
  intakes(): ImPersonIntakeRow[] {
    return this.store.intakes()
  }

  /** Persist one automatic-intake record through the people write chain. */
  recordIntake(row: ImPersonIntakeRow): Promise<void> {
    return this.mutations.recordIntake(row)
  }

  /** Drop every address of one account after the account is removed. */
  removeAddressesOf(accountId: string): Promise<void> {
    return this.mutations.removeAddressesOf(accountId)
  }

  /** Every person with all of their addresses. */
  private views(): ImPersonView[] {
    const addresses = this.store.personAddresses()
    const byPerson = new Map<string, ImPersonAddressRow[]>()
    for (const address of addresses) {
      const own = byPerson.get(address.person_id)
      if (own === undefined) byPerson.set(address.person_id, [address])
      else own.push(address)
    }
    return this.store.people().map(row => viewOf(row, byPerson.get(row.id) ?? []))
  }
}
