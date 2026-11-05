/**
 * The address book's names: real name, provider nickname, self-report, and the
 * raw provider id fallback must not be confused with one another.
 * 通讯录的称呼：真名、provider 昵称、自述与裸 provider id 回退不能互相混淆。
 */

import { describe, expect, it } from 'vitest'
import { zh } from '../src/client/locales.ts'
import { isUnnamedPerson, personLabel } from '../src/client/person-label.ts'
import type { ImPersonView } from '../src/client/remote.ts'

/** The Chinese dictionary as the locale seat. */
const t = (key: keyof typeof zh): string => zh[key]

/** One person view with the directory's required fields. */
function person(overrides: Partial<ImPersonView>): ImPersonView {
  return {
    id: 'person-1',
    displayName: 'wxid-yang',
    aliases: [],
    contacts: [],
    claimedContacts: [],
    identityStatus: 'unverified',
    addresses: [{
      provider: 'wechat',
      accountId: 'acc-1',
      conversationId: 'p2p:wxid-yang',
      externalId: 'wxid-yang',
    }],
    updatedAt: 1_000,
    ...overrides,
  }
}

describe('personLabel', () => {
  it('uses a recorded real name first', () => {
    expect(personLabel(person({ realName: '杨明明' }), t)).toBe('杨明明')
  })

  it('shows a provider nickname as it is', () => {
    const named = person({ displayName: '明明' })
    expect(isUnnamedPerson(named)).toBe(false)
    expect(personLabel(named, t)).toBe('明明')
  })

  it('falls back to "WeChat user · handle" for a raw provider id', () => {
    const raw = person({})
    expect(isUnnamedPerson(raw)).toBe(true)
    expect(personLabel(raw, t)).toBe('微信用户 · wxid-yang')
  })

  it('prefers the unverified self-report over a raw provider id', () => {
    const claimed = person({ claimedName: '小林' })
    expect(personLabel(claimed, t)).toBe('小林')
  })

  it('keeps a manually entered contact name', () => {
    const manual = person({ displayName: '小林', addresses: [] })
    expect(isUnnamedPerson(manual)).toBe(false)
    expect(personLabel(manual, t)).toBe('小林')
  })
})
