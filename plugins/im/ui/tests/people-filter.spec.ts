/**
 * The people search box's local filter: the fields a human expects to type.
 * 人员搜索框的本地过滤：人真的会去输入的那些字段。
 */

import { describe, expect, it } from 'vitest'
import { filterPeople } from '../src/client/people-filter.ts'
import type { ImPersonView } from '../src/client/remote.ts'

/** One person with every searchable field populated. */
/** 一个所有可搜索字段都有值的人。 */
function person(overrides: Partial<ImPersonView> = {}): ImPersonView {
  return {
    id: 'person-1',
    displayName: '明明',
    realName: '杨明明',
    aliases: ['杨总', 'Ming'],
    contacts: [{ kind: 'email', value: 'yang@example.com' }],
    claimedContacts: [],
    identityStatus: 'verified',
    addresses: [{
      provider: 'wechat',
      accountId: 'acc-1',
      conversationId: 'p2p:wxid-yang',
      externalId: 'wxid-yang',
    }],
    bio: '产品经理',
    notes: '周会认识',
    updatedAt: 1_000,
    ...overrides,
  }
}

describe('filterPeople', () => {
  it('returns everyone for a blank query', () => {
    const people = [person(), person({ id: 'person-2', displayName: '小林' })]
    expect(filterPeople(people, '')).toHaveLength(2)
    expect(filterPeople(people, '   ')).toHaveLength(2)
  })

  it('matches names, aliases, contacts, notes, and addresses', () => {
    const people = [
      person(),
      person({
        id: 'person-2',
        displayName: '小林',
        realName: '林晓',
        aliases: [],
        contacts: [],
        addresses: [],
        bio: undefined,
        notes: undefined,
      }),
    ]
    for (const query of ['明明', '杨总', 'ming', 'yang@example.com', '周会', 'wxid-yang']) {
      expect(filterPeople(people, query).map(it => it.id)).toEqual(['person-1'])
    }
  })

  it('ignores case and width while matching', () => {
    expect(filterPeople([person()], 'ＭＩＮＧ')).toHaveLength(1)
  })

  it('returns an empty list when nothing matches', () => {
    expect(filterPeople([person()], '不存在的人')).toEqual([])
  })
})
