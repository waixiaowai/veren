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
 * @module @veren/im/people
 */

import { randomUUID } from 'node:crypto'
import { defineToken } from '@veren/core'
import { ImError } from './contract.ts'
import type { ImMessage, ImPersonClaim, ImPersonContact } from './contract.ts'
import type { ImLogger } from './bindings.ts'
import type { ImPersonAddressRow, ImPersonIntakeRow, ImPersonRow, ImPersonStore } from './store.ts'

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

/** The `imPeople` service token. */
export const ImPeopleToken = defineToken<ImPeople>('imPeople')
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** People directory, provided by @veren/im. */
    imPeople: ImPeople
  }
}

/** Hard cap on exact ambiguity candidates returned by a resolution. */
export const MAX_PERSON_CANDIDATES = 20
/** Default and maximum directory listing sizes. */
export const DEFAULT_PERSON_LIMIT = 50
export const MAX_PERSON_LIMIT = 200
const MAX_SUGGESTIONS = 5
const MAX_NAME_CHARS = 200

/** Field precedence when one person matches through several fields at once. */
const PRECEDENCE: Record<ImPersonMatchField, number> = {
  id: 0,
  realName: 1,
  displayName: 2,
  alias: 3,
  contact: 4,
  address: 5,
  claimedName: 6,
  claimedContact: 7,
}

/** Normalize text for comparison: NFKC, trim, collapse spaces, case-fold. */
function normalizeText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

/**
 * Keep one human-facing name on one line. Provider-supplied names are untrusted
 * input, so a newline must not be able to forge another prompt section.
 * 让人类可读的名字保持单行。provider 提供的名字是不可信输入，换行不能用来伪造另一个提示区块。
 */
function oneLine(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim()
}

/** Clean a provider-supplied name; provider names are capped, never rejected. */
function providerName(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const name = oneLine(value).slice(0, MAX_NAME_CHARS)
  return name === '' ? undefined : name
}

/** Digits only, used to compare phone numbers written with separators. */
function digitsOf(value: string): string {
  return value.replace(/\D/g, '')
}

/**
 * Whether one stored contact equals the normalized query.
 *
 * Phone numbers ignore separators and a country prefix ("+86"), but the shorter
 * side must still have at least seven digits: an extension-sized suffix is not
 * evidence of identity, and a real ambiguity is still reported as ambiguous.
 * 已存联系方式是否等于归一化后的查询。
 *
 * 电话忽略分隔符与国家前缀（"+86"），但较短一侧至少要有七位数字：分机号长度的后缀不足以证明
 * 是同一个人，真正的重名仍会以歧义上报。
 */
function contactMatches(contact: ImPersonContact, query: string): boolean {
  if (normalizeText(contact.value) === query) return true
  if (contact.kind !== 'phone') return false
  const stored = digitsOf(contact.value)
  const asked = digitsOf(query)
  if (stored.length < 5 || asked.length < 5) return false
  if (stored === asked) return true
  const [shorter, longer] = stored.length <= asked.length ? [stored, asked] : [asked, stored]
  return shorter.length >= 7 && longer.endsWith(shorter)
}

/** Whether one address filter accepts an address row. */
function addressMatches(
  address: { provider: string; account_id: string },
  filter: ImPersonAddressFilter,
): boolean {
  return (filter.provider === undefined || address.provider === filter.provider)
    && (filter.accountId === undefined || address.account_id === filter.accountId)
}

/** Whether a filter restricts anything at all. */
function hasFilter(filter: ImPersonAddressFilter): boolean {
  return filter.provider !== undefined || filter.accountId !== undefined
}

/** Copy one address row into its public view. */
function toAddressView(row: ImPersonAddressRow): ImPersonAddressView {
  return {
    provider: row.provider,
    accountId: row.account_id,
    conversationId: row.conversation_id,
    externalId: row.external_id,
    ...(row.display_name === undefined ? {} : { displayName: row.display_name }),
  }
}

/** Copy a profile and its addresses into one public view. */
function viewOf(row: ImPersonRow, addresses: ImPersonAddressRow[]): ImPersonView {
  const claim = row.claim
  return {
    id: row.id,
    displayName: row.display_name,
    ...(row.real_name === undefined ? {} : { realName: row.real_name }),
    aliases: [...row.aliases],
    contacts: row.contacts.map(contact => ({ ...contact })),
    ...(row.bio === undefined ? {} : { bio: row.bio }),
    ...(row.notes === undefined ? {} : { notes: row.notes }),
    ...(claim?.name === undefined ? {} : { claimedName: claim.name }),
    claimedContacts: claim === undefined ? [] : claim.contacts.map(contact => ({ ...contact })),
    ...(claim === undefined ? {} : { claimedAt: claim.at }),
    identityStatus: row.real_name !== undefined
      ? 'verified'
      : claim === undefined ? 'unverified' : 'self-reported',
    addresses: addresses
      .map(toAddressView)
      .sort((left, right) => `${left.provider}\u0000${left.accountId}\u0000${left.conversationId}`
        .localeCompare(`${right.provider}\u0000${right.accountId}\u0000${right.conversationId}`)),
    updatedAt: row.updated_at,
  }
}

/** Sort two views by their human-facing name. */
function byName(left: ImPersonView, right: ImPersonView): number {
  return left.displayName.localeCompare(right.displayName, 'zh-Hans-CN')
}

/** Keep only addresses the filter accepts. */
function withFilteredAddresses(view: ImPersonView, filter: ImPersonAddressFilter): ImPersonView {
  if (!hasFilter(filter)) return view
  return {
    ...view,
    addresses: view.addresses.filter(address => (
      (filter.provider === undefined || address.provider === filter.provider)
      && (filter.accountId === undefined || address.accountId === filter.accountId)
    )),
  }
}

/** Clamp one listing limit into the supported range. */
function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_PERSON_LIMIT
  return Math.max(1, Math.min(MAX_PERSON_LIMIT, Math.trunc(limit)))
}

/** Levenshtein distance; used only to rank suggestions, never to match. */
function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0]!
    previous[0] = row
    for (let column = 1; column <= right.length; column += 1) {
      const above = previous[column]!
      const cost = left[row - 1] === right[column - 1] ? 0 : 1
      previous[column] = Math.min(previous[column]! + 1, previous[column - 1]! + 1, diagonal + cost)
      diagonal = above
    }
  }
  return previous[right.length]!
}

/** Derive the provider user id from an address input. */
function externalIdOf(input: ImPersonAddressInput): string {
  const explicit = input.externalId?.trim()
  if (explicit !== undefined && explicit !== '') return explicit
  const conversation = input.conversationId.trim()
  return (conversation.startsWith('p2p:') ? conversation.slice(4) : conversation).trim()
}

/** Pick the contact kind a provider's user id belongs to. */
function contactKindOf(provider: string): ImPersonContact['kind'] {
  switch (provider) {
    case 'wechat':
    case 'email':
    case 'phone':
      return provider
    default:
      return 'other'
  }
}

/** Trim, deduplicate, and drop empty aliases. */
function cleanAliases(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    const key = normalizeText(trimmed)
    if (trimmed === '' || seen.has(key)) continue
    seen.add(key)
    result.push(trimmed)
  }
  return result
}

/** Validate contacts and deduplicate by kind plus normalized value. */
function cleanContacts(values: ImPersonContact[]): ImPersonContact[] {
  const seen = new Set<string>()
  const result: ImPersonContact[] = []
  for (const value of values) {
    const kind = value.kind
    if (kind !== 'wechat' && kind !== 'email' && kind !== 'phone' && kind !== 'other') {
      throw new ImError('IM_INVALID_REQUEST', `unknown contact kind: ${String(kind)}`)
    }
    const text = value.value.trim()
    if (text === '') throw new ImError('IM_INVALID_REQUEST', 'contact value is required')
    const key = `${kind}\u0000${normalizeText(text)}`
    if (seen.has(key)) continue
    seen.add(key)
    const label = value.label?.trim()
    result.push({ kind, value: text, ...(label === undefined || label === '' ? {} : { label }) })
  }
  return result
}

/** Apply the profile patch onto a copy of one row. */
function applyProfile(row: ImPersonRow, request: ImPersonSaveRequest, now: number): ImPersonRow {
  const next: ImPersonRow = {
    ...row,
    aliases: [...row.aliases],
    contacts: row.contacts.map(contact => ({ ...contact })),
    updated_at: now,
  }
  if (request.displayName !== undefined) {
    const name = oneLine(request.displayName)
    if (name === '') throw new ImError('IM_INVALID_REQUEST', 'displayName must not be empty')
    if (name.length > MAX_NAME_CHARS) {
      throw new ImError('IM_INVALID_REQUEST', `displayName must be at most ${MAX_NAME_CHARS} characters`)
    }
    next.display_name = name
  }
  if (request.realName !== undefined) {
    const name = oneLine(request.realName)
    if (name === '') delete next.real_name
    else if (name.length > MAX_NAME_CHARS) {
      throw new ImError('IM_INVALID_REQUEST', `realName must be at most ${MAX_NAME_CHARS} characters`)
    } else next.real_name = name
  }
  if (request.aliases !== undefined) next.aliases = cleanAliases(request.aliases)
  if (request.contacts !== undefined) next.contacts = cleanContacts(request.contacts)
  if (request.bio !== undefined) {
    const bio = request.bio.trim()
    if (bio === '') delete next.bio
    else next.bio = bio
  }
  if (request.notes !== undefined) {
    const notes = request.notes.trim()
    if (notes === '') delete next.notes
    else next.notes = notes
  }
  if (request.clearClaim === true) delete next.claim
  return next
}

/**
 * Validate one self-report and stamp its provenance. An empty report is
 * rejected: recording "nothing" would look like a successful answer.
 * 校验一条自述并盖章来源。空自述被拒绝：记录「什么都没说」会被误当成已回答。
 */
function claimOf(input: ImPersonClaimInput, now: number): ImPersonClaim {
  const name = input.name === undefined ? undefined : oneLine(input.name)
  if (name !== undefined && (name === '' || name.length > MAX_NAME_CHARS)) {
    throw new ImError('IM_INVALID_REQUEST', `claimed name must be 1-${MAX_NAME_CHARS} characters`)
  }
  const contacts = cleanContacts(input.contacts ?? [])
  if (name === undefined && contacts.length === 0) {
    throw new ImError('IM_INVALID_REQUEST', 'a self-report needs a name or a contact')
  }
  const provider = input.provider.trim()
  const accountId = input.accountId.trim()
  const conversationId = input.conversationId.trim()
  const messageId = input.messageId.trim()
  if (provider === '' || accountId === '' || conversationId === '' || messageId === '') {
    throw new ImError('IM_INVALID_REQUEST', 'provider, accountId, conversationId, and messageId are required')
  }
  return {
    ...(name === undefined ? {} : { name }),
    contacts,
    source: 'self-report',
    provider,
    accountId,
    conversationId,
    messageId,
    at: now,
  }
}

/**
 * People directory: persistence-facing read/write operations plus strict name
 * resolution. It never sends; the router owns that step.
 * 人员目录：面向持久化的读写操作与严格名字解析。它从不发送；发送由路由层负责。
 */
export class ImPeople {
  private readonly store: ImPersonStore
  private readonly logger: ImLogger
  private readonly newId: (prefix: string) => string
  private readonly now: () => number
  // Serializes writes so two concurrent observations of one sender cannot
  // create two profiles for the same address.
  // 串行化写入，两个并发的同一发送者观察不会为同一个地址创建两份档案。
  private writeChain: Promise<unknown> = Promise.resolve()

  constructor(options: ImPeopleOptions) {
    this.store = options.store
    this.logger = options.logger
    this.newId = options.newId ?? (prefix => `${prefix}_${randomUUID()}`)
    this.now = options.now ?? Date.now
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
      .filter(view => query === undefined || this.matchesQuery(view, query))
      .sort(byName)
      .slice(0, clampLimit(request.limit))
  }

  /** Resolve one exact name, alias, contact, id, or address. */
  resolve(query: string, filter: ImPersonAddressFilter = {}): ImPersonResolution {
    const raw = query.trim()
    const normalized = normalizeText(raw)
    if (raw === '') throw new ImError('IM_INVALID_REQUEST', 'person query is required')
    const matches = new Map<string, ImPersonMatch>()
    for (const view of this.views()) {
      const match = this.exactMatch(view, raw, normalized)
      if (match === undefined) continue
      const previous = matches.get(view.id)
      if (previous === undefined || PRECEDENCE[match.matchedBy] < PRECEDENCE[previous.matchedBy]) {
        matches.set(view.id, match)
      }
    }
    const candidates = [...matches.values()]
      .sort((left, right) => byName(left.person, right.person))
      .slice(0, MAX_PERSON_CANDIDATES)
    if (candidates.length === 1) return { status: 'matched', match: candidates[0]! }
    if (candidates.length > 1) return { status: 'ambiguous', candidates }
    const pool = this.views()
      .map(view => withFilteredAddresses(view, filter))
      .filter(view => !hasFilter(filter) || view.addresses.length > 0)
    return { status: 'not-found', suggestions: this.suggestions(normalized, pool) }
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
  async observeMessage(providerId: string, message: ImMessage): Promise<ImPersonView | undefined> {
    const externalId = message.sender.id.trim()
    if (externalId === '') return undefined
    return this.observeConversation({
      provider: providerId,
      accountId: message.accountId,
      conversationId: message.conversationId,
      externalId,
      ...(message.sender.name === undefined ? {} : { displayName: message.sender.name }),
    })
  }

  /**
   * Register one provider address. Idempotent: the same provider user id always
   * updates the same person instead of creating a duplicate.
   * 登记一个 provider 地址。幂等：同一个 provider 用户 id 永远更新同一个人，不会创建重复记录。
   */
  observeConversation(input: ImPersonAddressInput): Promise<ImPersonView> {
    return this.write(() => this.observeNow(input))
  }

  /** Observation body, run under the write chain. */
  private async observeNow(input: ImPersonAddressInput): Promise<ImPersonView> {
    const address = this.addressOf(input)
    const now = this.now()
    const displayName = providerName(input.displayName)
    const existing = this.store.getPersonAddress(address.provider, address.accountId, address.externalId)
    const existingPerson = existing === undefined ? undefined : this.store.getPerson(existing.person_id)
    if (existing !== undefined && existingPerson === undefined) {
      this.logger.warn(
        `[im:people] address ${address.provider}/${address.accountId}/${address.externalId}`
        + ' referenced a missing person; the address will be reattached',
      )
    }
    let person: ImPersonRow
    if (existingPerson !== undefined) {
      person = await this.observeExisting(existingPerson, existing!, displayName, now)
      const displayChanged = displayName !== undefined && displayName !== ''
        && existing!.display_name !== displayName
      const conversationChanged = existing!.conversation_id !== address.conversationId
      if (displayChanged || conversationChanged) {
        await this.store.putPersonAddress({
          ...existing!,
          conversation_id: address.conversationId,
          ...(displayChanged ? { display_name: displayName } : {}),
          updated_at: now,
        })
      }
    } else {
      person = this.createPerson(address, displayName, now)
      await this.store.putPerson(person)
      await this.store.putPersonAddress({
        person_id: person.id,
        provider: address.provider,
        account_id: address.accountId,
        conversation_id: address.conversationId,
        external_id: address.externalId,
        ...(displayName === undefined || displayName === '' ? {} : { display_name: displayName }),
        updated_at: now,
      })
    }
    return this.viewOfPerson(person.id)
  }

  /**
   * Create a person from an address, or enrich an existing person.
   *
   * An address already owned by a different person is rejected: silently
   * stealing it would make two humans share one destination.
   * 从地址创建人员，或补充已有人员。地址已属于另一个人时拒绝：静默抢占会让两个人共用一个目的地。
   */
  save(request: ImPersonSaveRequest): Promise<ImPersonView> {
    return this.write(() => this.saveNow(request))
  }

  /** Save body, run under the write chain. */
  private async saveNow(request: ImPersonSaveRequest): Promise<ImPersonView> {
    if (request.personId === undefined && request.address === undefined) {
      throw new ImError('IM_INVALID_REQUEST', 'personId or address is required')
    }
    const now = this.now()
    let person = request.personId === undefined ? undefined : this.store.getPerson(request.personId)
    if (request.personId !== undefined && person === undefined) {
      throw new ImError('IM_NOT_FOUND', `unknown person: ${request.personId}`)
    }
    const address = request.address === undefined ? undefined : this.addressOf(request.address)
    const existingAddress = address === undefined
      ? undefined
      : this.store.getPersonAddress(address.provider, address.accountId, address.externalId)
    if (existingAddress !== undefined) {
      if (person !== undefined && existingAddress.person_id !== person.id) {
        throw new ImError(
          'IM_INVALID_REQUEST',
          `address already belongs to person ${existingAddress.person_id}`,
        )
      }
      if (person === undefined) {
        person = this.store.getPerson(existingAddress.person_id)
        if (person === undefined) throw new ImError('IM_NOT_FOUND', 'the address owner is missing')
      }
    }
    if (person === undefined) {
      if (address === undefined) throw new ImError('IM_INVALID_REQUEST', 'address is required to create a person')
      person = {
        id: this.newId('person'),
        display_name: providerName(request.displayName)
          ?? providerName(request.address?.displayName)
          ?? address.externalId,
        aliases: [],
        contacts: [{
          kind: contactKindOf(address.provider),
          value: address.externalId,
        }],
        updated_at: now,
      }
    }
    const updated = applyProfile(person, request, now)
    await this.store.putPerson(updated)
    if (address !== undefined && existingAddress === undefined) {
      const displayName = providerName(request.address?.displayName)
      await this.store.putPersonAddress({
        person_id: updated.id,
        provider: address.provider,
        account_id: address.accountId,
        conversation_id: address.conversationId,
        external_id: address.externalId,
        ...(displayName === undefined ? {} : { display_name: displayName }),
        updated_at: now,
      })
    } else if (existingAddress !== undefined && request.address !== undefined) {
      const displayName = providerName(request.address.displayName)
      const displayChanged = displayName !== undefined && existingAddress.display_name !== displayName
      const conversationChanged = existingAddress.conversation_id !== address!.conversationId
      if (displayChanged || conversationChanged) {
        await this.store.putPersonAddress({
          ...existingAddress,
          conversation_id: address!.conversationId,
          ...(displayChanged ? { display_name: displayName } : {}),
          updated_at: now,
        })
      }
    }
    return this.viewOfPerson(updated.id)
  }

  /**
   * Record one unverified self-report on a person. Authoritative fields are
   * never touched, and the first report wins: a later observation cannot
   * rewrite what the person said about themselves.
   * 在一个人身上记录一条未核实自述。权威字段永不被改动，且第一条自述生效：之后的观察不能
   * 改写对方说过的身份。
   */
  recordClaim(personId: string, input: ImPersonClaimInput): Promise<ImPersonView> {
    return this.write(() => this.claimNow(personId, input))
  }

  /** Claim body, run under the write chain. */
  private async claimNow(personId: string, input: ImPersonClaimInput): Promise<ImPersonView> {
    const person = this.store.getPerson(personId)
    if (person === undefined) throw new ImError('IM_NOT_FOUND', `unknown person: ${personId}`)
    if (person.claim !== undefined) {
      this.logger.info?.(`[im:people] person ${personId} already carries a self-report; kept the first one`)
      return this.viewOfPerson(personId)
    }
    const now = this.now()
    const updated: ImPersonRow = { ...person, claim: claimOf(input, now), updated_at: now }
    await this.store.putPerson(updated)
    return this.viewOfPerson(personId)
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
    return this.write(() => this.store.putIntake(row))
  }

  /** Drop every address of one account after the account is removed. */
  removeAddressesOf(accountId: string): Promise<void> {
    return this.write(() => this.store.deletePersonAddressesOf(accountId))
  }

  /** Serialize every mutation so concurrent observers cannot clone a person. */
  private write<T>(work: () => Promise<T>): Promise<T> {
    const pending = this.writeChain.then(work)
    this.writeChain = pending.catch(() => undefined)
    return pending
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

  /** Read one person after a write; a missing row is an internal failure. */
  private viewOfPerson(id: string): ImPersonView {
    const row = this.store.getPerson(id)
    if (row === undefined) throw new ImError('IM_INTERNAL', `person disappeared: ${id}`)
    return viewOf(row, this.store.personAddresses().filter(address => address.person_id === id))
  }

  /** Validate one address input and derive its provider user id. */
  private addressOf(input: ImPersonAddressInput): Required<Pick<ImPersonAddressInput, 'provider' | 'accountId' | 'conversationId' | 'externalId'>> {
    const provider = input.provider.trim()
    const accountId = input.accountId.trim()
    const conversationId = input.conversationId.trim()
    const externalId = externalIdOf(input)
    if (provider === '' || accountId === '' || conversationId === '' || externalId === '') {
      throw new ImError('IM_INVALID_REQUEST', 'provider, accountId, conversationId, and externalId are required')
    }
    return { provider, accountId, conversationId, externalId }
  }

  /** Create a fresh profile for one newly observed address. */
  private createPerson(
    address: { provider: string; externalId: string },
    displayName: string | undefined,
    now: number,
  ): ImPersonRow {
    return {
      id: this.newId('person'),
      display_name: displayName === undefined || displayName === '' ? address.externalId : displayName,
      aliases: [],
      contacts: [{ kind: contactKindOf(address.provider), value: address.externalId }],
      updated_at: now,
    }
  }

  /**
   * Apply a provider-supplied name only while the profile still carries the
   * provider's old name or the raw id; a name a human chose is never overwritten.
   * 仅当档案仍使用 provider 的旧名字或裸 id 时才写入 provider 提供的新名字；人取的名字永不被覆盖。
   */
  private async observeExisting(
    person: ImPersonRow,
    address: ImPersonAddressRow,
    displayName: string | undefined,
    now: number,
  ): Promise<ImPersonRow> {
    if (displayName === undefined || displayName === '') return person
    const current = normalizeText(person.display_name)
    const previous = address.display_name === undefined ? undefined : normalizeText(address.display_name)
    const rawId = normalizeText(address.external_id)
    const canRename = current === rawId || (previous !== undefined && current === previous)
    if (!canRename || current === normalizeText(displayName)) return person
    const updated: ImPersonRow = { ...person, display_name: displayName, updated_at: now }
    await this.store.putPerson(updated)
    return updated
  }

  /** Whether one view contains the query text anywhere a human could type it. */
  private matchesQuery(view: ImPersonView, query: string): boolean {
    const values = [
      view.id,
      view.displayName,
      ...(view.realName === undefined ? [] : [view.realName]),
      ...view.aliases,
      ...view.contacts.map(contact => contact.value),
      ...(view.claimedName === undefined ? [] : [view.claimedName]),
      ...view.claimedContacts.map(contact => contact.value),
      ...view.addresses.flatMap(address => [address.externalId, address.conversationId]),
    ]
    return values.some(value => normalizeText(value).includes(query))
  }

  /** Exact match only; the returned field is the evidence shown to the user. */
  private exactMatch(
    view: ImPersonView,
    raw: string,
    normalized: string,
  ): ImPersonMatch | undefined {
    if (view.id === raw) return { person: view, matchedBy: 'id', matchedValue: view.id }
    if (view.realName !== undefined && normalizeText(view.realName) === normalized) {
      return { person: view, matchedBy: 'realName', matchedValue: view.realName }
    }
    if (normalizeText(view.displayName) === normalized) {
      return { person: view, matchedBy: 'displayName', matchedValue: view.displayName }
    }
    for (const alias of view.aliases) {
      if (normalizeText(alias) === normalized) {
        return { person: view, matchedBy: 'alias', matchedValue: alias }
      }
    }
    for (const contact of view.contacts) {
      if (contactMatches(contact, normalized)) {
        return {
          person: view,
          matchedBy: 'contact',
          matchedValue: `${contact.kind}:${contact.value}`,
        }
      }
    }
    if (view.claimedName !== undefined && normalizeText(view.claimedName) === normalized) {
      return { person: view, matchedBy: 'claimedName', matchedValue: view.claimedName }
    }
    for (const contact of view.claimedContacts) {
      if (contactMatches(contact, normalized)) {
        return {
          person: view,
          matchedBy: 'claimedContact',
          matchedValue: `${contact.kind}:${contact.value}`,
        }
      }
    }
    for (const address of view.addresses) {
      if (normalizeText(address.externalId) === normalized
        || normalizeText(address.conversationId) === normalized) {
        return {
          person: view,
          matchedBy: 'address',
          matchedValue: address.externalId,
          address,
        }
      }
    }
    return undefined
  }

  /** Rank close names for a not-found result; suggestions are never sendable. */
  private suggestions(query: string, views: ImPersonView[]): ImPersonView[] {
    const threshold = query.length <= 3 ? 1 : 2
    const scored: Array<{ view: ImPersonView; score: number }> = []
    for (const view of views) {
      const names = [
        view.displayName,
        ...(view.realName === undefined ? [] : [view.realName]),
        ...view.aliases,
        ...view.contacts.map(contact => contact.value),
        ...(view.claimedName === undefined ? [] : [view.claimedName]),
        ...view.claimedContacts.map(contact => contact.value),
      ]
      let score = Number.POSITIVE_INFINITY
      for (const name of names) {
        const normalized = normalizeText(name)
        if (normalized === '') continue
        if (normalized.includes(query) || (normalized.length >= 2 && query.includes(normalized))) {
          score = Math.min(score, Math.abs(normalized.length - query.length))
          continue
        }
        score = Math.min(score, editDistance(normalized, query))
      }
      if (score <= threshold) scored.push({ view, score })
    }
    return scored
      .sort((left, right) => left.score - right.score || byName(left.view, right.view))
      .slice(0, MAX_SUGGESTIONS)
      .map(item => item.view)
  }
}
