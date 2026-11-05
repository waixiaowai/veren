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
import type { ImPersonView } from './remote.ts'

/** The short handle of a provider id (the part before `@`, elided when long). */
export function shortHandle(value: string): string {
  const at = value.indexOf('@')
  const head = at === -1 ? value : value.slice(0, at)
  return head.length <= 10 ? head : `${head.slice(0, 6)}…${head.slice(-2)}`
}

/** Whether the profile still shows the raw provider id as its name. */
export function isUnnamedPerson(person: ImPersonView): boolean {
  return person.identityStatus === 'unverified' && person.realName === undefined
}

/**
 * The display name one person shows.
 * @param person - the people-directory view.
 * @param t - locale seat.
 * @returns the name a human should read.
 */
export function personLabel(person: ImPersonView, t: (key: ImKey) => string): string {
  if (!isUnnamedPerson(person)) return person.realName ?? person.displayName
  return `${t('unnamedPerson')} · ${shortHandle(person.displayName)}`
}
