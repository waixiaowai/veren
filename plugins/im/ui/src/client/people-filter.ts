/**
 * Local search over the people directory for the panel's search box.
 *
 * The host's `people()` endpoint applies the same substring rule, but the
 * panel already holds the full catalog and filters on every keystroke; doing
 * it locally keeps the box responsive without a round trip per character.
 *
 * 面板搜索框的本地人员过滤。
 *
 * 宿主的 `people()` 端点用同一条子串规则，但面板本就持有完整目录并逐键过滤；在本地完成
 * 可以让搜索框即时响应，不必每敲一个字就往返一次。
 *
 * @module @veren/im-ui/client/people-filter
 */

import type { ImPersonView } from './remote.ts'

/** Case- and width-insensitive form used for every comparison. */
/** 每次比较使用的、忽略大小写与全半角的归一化形式。 */
function normalized(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase()
}

/** Every field a human could type to find this person. */
/** 人能想到用它找人的每一个字段。 */
function searchableValues(person: ImPersonView): string[] {
  return [
    person.id,
    person.displayName,
    person.realName ?? '',
    ...person.aliases,
    ...person.contacts.map(contact => contact.value),
    person.claimedName ?? '',
    ...person.claimedContacts.map(contact => contact.value),
    person.bio ?? '',
    person.notes ?? '',
    ...person.addresses.flatMap(address => [address.externalId, address.conversationId]),
  ]
}

/**
 * Keep the people whose profile contains the query anywhere a human could type
 * it. An empty or blank query matches everyone.
 * @param people - the catalog's people.
 * @param query - raw search text.
 * @returns the matching people, in input order.
 */
export function filterPeople(people: readonly ImPersonView[], query: string): ImPersonView[] {
  const needle = normalized(query)
  if (needle === '') return [...people]
  return people.filter(person => searchableValues(person).some(value => normalized(value).includes(needle)))
}
