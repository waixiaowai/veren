/**
 * Input hygiene for the people directory: text normalization, name cleaning,
 * contact validation, the profile patch, and self-report stamping.
 *
 * Provider-supplied names are untrusted input, so everything a provider or the
 * model sends is normalized, single-lined, and capped here — never rejected
 * for being long, only for being empty or structurally invalid.
 *
 * 人员目录的输入清洗：文本归一化、名字清洗、联系方式校验、档案补丁与自述盖章。
 *
 * provider 提供的名字是不可信输入，因此 provider 或模型发来的一切都在这里归一化、压成单行并
 * 限长——过长从不拒绝，只有空值或结构非法才报错。
 *
 * @module @veren/im/people-text
 */

import { ImError } from './contract.ts'
import type { ImPersonClaim, ImPersonContact } from './contract.ts'
import type { ImPersonAddressInput, ImPersonClaimInput, ImPersonSaveRequest } from './people-types.ts'
import type { ImPersonRow } from './store.ts'

/** Hard cap on one human-facing name. */
const MAX_NAME_CHARS = 200

/** Normalize text for comparison: NFKC, trim, collapse spaces, case-fold. */
export function normalizeText(value: string): string {
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
export function providerName(value: string | undefined): string | undefined {
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
export function contactMatches(contact: ImPersonContact, query: string): boolean {
  if (normalizeText(contact.value) === query) return true
  if (contact.kind !== 'phone') return false
  const stored = digitsOf(contact.value)
  const asked = digitsOf(query)
  if (stored.length < 5 || asked.length < 5) return false
  if (stored === asked) return true
  const [shorter, longer] = stored.length <= asked.length ? [stored, asked] : [asked, stored]
  return shorter.length >= 7 && longer.endsWith(shorter)
}

/** Derive the provider user id from an address input. */
export function externalIdOf(input: ImPersonAddressInput): string {
  const explicit = input.externalId?.trim()
  if (explicit !== undefined && explicit !== '') return explicit
  const conversation = input.conversationId.trim()
  return (conversation.startsWith('p2p:') ? conversation.slice(4) : conversation).trim()
}

/**
 * Validate one address input and derive its provider user id. Shared by the
 * observation path and the save path so both refuse the same way.
 * 校验一个地址输入并推导 provider 用户 id。观察路径与保存路径共用，拒绝方式一致。
 */
export function validatedAddressOf(input: ImPersonAddressInput): Required<Pick<ImPersonAddressInput, 'provider' | 'accountId' | 'conversationId' | 'externalId'>> {
  const provider = input.provider.trim()
  const accountId = input.accountId.trim()
  const conversationId = input.conversationId.trim()
  const externalId = externalIdOf(input)
  if (provider === '' || accountId === '' || conversationId === '' || externalId === '') {
    throw new ImError('IM_INVALID_REQUEST', 'provider, accountId, conversationId, and externalId are required')
  }
  return { provider, accountId, conversationId, externalId }
}

/** Pick the contact kind a provider's user id belongs to. */
export function contactKindOf(provider: string): ImPersonContact['kind'] {
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
export function applyProfile(row: ImPersonRow, request: ImPersonSaveRequest, now: number): ImPersonRow {
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
export function claimOf(input: ImPersonClaimInput, now: number): ImPersonClaim {
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
