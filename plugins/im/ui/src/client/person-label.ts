/**
 * The name a person shows in the panel: the real name when a human recorded
 * one, the claimed name when only the person's own statement exists, and
 * "WeChat user · short handle" while the profile still carries a raw provider
 * id. Address handles are shortened the same way everywhere.
 *
 * 面板上人显示的名字：人录过真名用真名，只有对方自述用自称，档案还带着裸 provider id 时
 * 显示「微信用户 · 短码」。联系方式的短码在各处使用同一套规则。
 *
 * @module @veren/im-ui/client/person-label
 */

import type { ImKey } from './locales.ts'
import type { ImPersonContact, ImPersonView } from './remote.ts'

/** The short handle of a provider id (the part before `@`, elided when long). */
export function shortHandle(value: string): string {
  const at = value.indexOf('@')
  const head = at === -1 ? value : value.slice(0, at)
  return head.length <= 10 ? head : `${head.slice(0, 6)}…${head.slice(-2)}`
}

/** The locale key of one contact method kind. */
/** 一种联系方式对应的文案键。 */
export function contactKindKey(kind: ImPersonContact['kind']): ImKey {
  switch (kind) {
    case 'wechat': return 'contactKindWechat'
    case 'email': return 'contactKindEmail'
    case 'phone': return 'contactKindPhone'
    case 'other': return 'contactKindOther'
  }
}

/**
 * Whether the profile still shows a raw provider id as its name.
 *
 * A missing real name is not enough: a provider-supplied nickname and a
 * manually entered contact are both names a human can read. Only a display
 * name that equals one of the person's own address ids is plumbing.
 * 档案是否仍拿裸 provider id 当名字。
 *
 * 只缺真名不算：provider 给的昵称与手工录入的名字都是人能读的名字。只有显示名恰好等于此人某个
 * 地址的 provider 用户 id 时，才是管道值。
 */
export function isUnnamedPerson(person: ImPersonView): boolean {
  return person.realName === undefined
    && person.addresses.some(address => address.externalId === person.displayName)
}

/**
 * The display name one person shows: a recorded real name, the raw-id fallback
 * (or the person's own unverified claim when they gave one), and otherwise the
 * name the provider or a human typed.
 * @param person - the people-directory view.
 * @param t - locale seat.
 * @returns the name a human should read.
 */
export function personLabel(person: ImPersonView, t: (key: ImKey) => string): string {
  if (person.realName !== undefined) return person.realName
  if (isUnnamedPerson(person)) {
    return person.claimedName ?? `${t('unnamedPerson')} · ${shortHandle(person.displayName)}`
  }
  return person.displayName
}
