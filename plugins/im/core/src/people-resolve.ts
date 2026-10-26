/**
 * Strict name resolution for the people directory: exact matching only, with
 * field precedence, ambiguity capping, and ranked suggestions for misses.
 *
 * Partial matches are never promoted to a send: one exact match resolves, two
 * or more are ambiguous, zero return ranked suggestions. This module answers
 * "who did the user mean", not "who looks closest".
 *
 * 人员目录的严格名字解析：只做精确匹配，带字段优先级、歧义候选上限与未命中时的排序建议。
 *
 * 部分匹配永远不会被提升为发送：恰好一个精确匹配才解析成功，两个及以上是歧义，零个返回排序
 * 建议。这一层回答「用户指的是谁」，而不是「谁看起来最像」。
 *
 * @module @veren/im/people-resolve
 */

import { MAX_PERSON_CANDIDATES } from './people-types.ts'
import type { ImPersonMatch, ImPersonMatchField, ImPersonView } from './people-types.ts'
import type { ImPersonContact } from './contract.ts'
import { contactMatches, normalizeText } from './people-text.ts'
import { byName } from './people-view.ts'

const MAX_SUGGESTIONS = 5

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

/**
 * Exact match only; the returned field is the evidence shown to the user. The
 * `??` chain is the field precedence: the first field that matches wins.
 * 只做精确匹配；返回的字段就是展示给用户的依据。`??` 链即字段优先级：先命中的字段胜出。
 */
export function exactMatch(
  view: ImPersonView,
  raw: string,
  normalized: string,
): ImPersonMatch | undefined {
  return identityMatchOf(view, raw, normalized)
    ?? aliasMatchOf(view, normalized)
    ?? contactMatchOf(view, view.contacts, normalized, 'contact', raw)
    ?? claimMatchOf(view, normalized, raw)
    ?? addressMatchOf(view, normalized)
}

/** Match by person id or one of the authoritative names. */
function identityMatchOf(view: ImPersonView, raw: string, normalized: string): ImPersonMatch | undefined {
  if (view.id === raw) return { person: view, matchedBy: 'id', matchedValue: view.id }
  if (view.realName !== undefined && normalizeText(view.realName) === normalized) {
    return { person: view, matchedBy: 'realName', matchedValue: view.realName }
  }
  if (normalizeText(view.displayName) === normalized) {
    return { person: view, matchedBy: 'displayName', matchedValue: view.displayName }
  }
  return undefined
}

/** Match by one alias. */
function aliasMatchOf(view: ImPersonView, normalized: string): ImPersonMatch | undefined {
  for (const alias of view.aliases) {
    if (normalizeText(alias) === normalized) {
      return { person: view, matchedBy: 'alias', matchedValue: alias }
    }
  }
  return undefined
}

/**
 * Match by one contact of the given field, authoritative or self-reported.
 * The evidence is the caller's raw input, not the stored value: the phone
 * matcher tolerates separators, country prefixes, and suffix matches, so the
 * stored string can name a different identifier than the one the user typed —
 * and the evidence shown to the user must be the one they recognize.
 * 按给定联系字段匹配（权威或自述）。证据用调用方的原始输入而非存储值：电话匹配
 * 容忍分隔符、国家前缀与后缀命中，存储字符串指认的可能是用户没打过的标识符——
 * 展示依据必须是用户认得的那一个。
 */
function contactMatchOf(
  view: ImPersonView,
  contacts: ImPersonContact[],
  normalized: string,
  matchedBy: 'contact' | 'claimedContact',
  raw: string,
): ImPersonMatch | undefined {
  for (const contact of contacts) {
    if (contactMatches(contact, normalized)) {
      return { person: view, matchedBy, matchedValue: raw }
    }
  }
  return undefined
}

/** Match by the unverified self-report: its name first, then its contacts. */
function claimMatchOf(view: ImPersonView, normalized: string, raw: string): ImPersonMatch | undefined {
  if (view.claimedName !== undefined && normalizeText(view.claimedName) === normalized) {
    return { person: view, matchedBy: 'claimedName', matchedValue: view.claimedName }
  }
  return contactMatchOf(view, view.claimedContacts, normalized, 'claimedContact', raw)
}

/** Match by one provider address: its external id or its conversation id. */
function addressMatchOf(view: ImPersonView, normalized: string): ImPersonMatch | undefined {
  for (const address of view.addresses) {
    // Report the value that actually matched, so the evidence shown to the
    // user never names a different identifier than the one they typed.
    // 上报真正命中的那个值，展示给用户的依据绝不指认另一个标识符。
    if (normalizeText(address.externalId) === normalized) {
      return { person: view, matchedBy: 'address', matchedValue: address.externalId, address }
    }
    if (normalizeText(address.conversationId) === normalized) {
      return { person: view, matchedBy: 'address', matchedValue: address.conversationId, address }
    }
  }
  return undefined
}

/** Rank close names for a not-found result; suggestions are never sendable. */
export function suggestions(query: string, views: ImPersonView[]): ImPersonView[] {
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

/** Keep the best match per person when one person matches several fields. */
export function keepBestMatch(
  previous: ImPersonMatch | undefined,
  next: ImPersonMatch,
): ImPersonMatch {
  if (previous === undefined || PRECEDENCE[next.matchedBy] < PRECEDENCE[previous.matchedBy]) {
    return next
  }
  return previous
}

/** Cap the ambiguity candidate list after sorting it by name. */
export function capCandidates(candidates: ImPersonMatch[]): ImPersonMatch[] {
  return [...candidates]
    .sort((left, right) => byName(left.person, right.person))
    .slice(0, MAX_PERSON_CANDIDATES)
}
