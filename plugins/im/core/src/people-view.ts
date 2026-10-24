/**
 * View assembly for the people directory: project storage rows onto the public
 * person views and keep every listing filtered, sorted, and clamped.
 *
 * Split out of `people.ts` so the service class stays under the file-size
 * ceiling; the export surface is unchanged — `people.ts` re-exports what it
 * exported before.
 *
 * 人员目录的视图装配：把存储行投影成公开的人员视图，并保证每个列表都经过过滤、排序与限长。
 *
 * 按职责从 `people.ts` 拆出，让服务类保持在单文件行数上限内；导出面不变——`people.ts`
 * 原样再导出原先导出的名字。
 *
 * @module @veren/im/people-view
 */

import { ImError } from './contract.ts'
import { DEFAULT_PERSON_LIMIT, MAX_PERSON_LIMIT } from './people-types.ts'
import type { ImPersonAddressFilter, ImPersonAddressView, ImPersonView } from './people-types.ts'
import { normalizeText } from './people-text.ts'
import type { ImPersonAddressRow, ImPersonRow, ImPersonStore } from './store.ts'

/** Whether one address filter accepts an address row. */
export function addressMatches(
  address: { provider: string; account_id: string },
  filter: ImPersonAddressFilter,
): boolean {
  return (filter.provider === undefined || address.provider === filter.provider)
    && (filter.accountId === undefined || address.account_id === filter.accountId)
}

/** Whether a filter restricts anything at all. */
export function hasFilter(filter: ImPersonAddressFilter): boolean {
  return filter.provider !== undefined || filter.accountId !== undefined
}

/** Copy one address row into its public view. */
export function toAddressView(row: ImPersonAddressRow): ImPersonAddressView {
  return {
    provider: row.provider,
    accountId: row.account_id,
    conversationId: row.conversation_id,
    externalId: row.external_id,
    ...(row.display_name === undefined ? {} : { displayName: row.display_name }),
  }
}

/** Copy a profile and its addresses into one public view. */
export function viewOf(row: ImPersonRow, addresses: ImPersonAddressRow[]): ImPersonView {
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

/** Read one person after a write; a missing row is an internal failure. */
export function viewOfPerson(store: ImPersonStore, id: string): ImPersonView {
  const row = store.getPerson(id)
  if (row === undefined) throw new ImError('IM_INTERNAL', `person disappeared: ${id}`)
  return viewOf(row, store.personAddresses().filter(address => address.person_id === id))
}

/** Sort two views by their human-facing name. */
export function byName(left: ImPersonView, right: ImPersonView): number {
  return left.displayName.localeCompare(right.displayName, 'zh-Hans-CN')
}

/** Keep only addresses the filter accepts. */
export function withFilteredAddresses(view: ImPersonView, filter: ImPersonAddressFilter): ImPersonView {
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
export function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_PERSON_LIMIT
  return Math.max(1, Math.min(MAX_PERSON_LIMIT, Math.trunc(limit)))
}

/** Whether one view contains the query text anywhere a human could type it. */
export function matchesQuery(view: ImPersonView, query: string): boolean {
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
