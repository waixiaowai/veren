/**
 * Shared fixtures for the people-directory specs: a fixed-clock directory over
 * the memory store, an address builder, and the seeded "Yang Mingming" profile.
 *
 * 人员目录测试的共享夹具：内存存储上定准时钟的目录、地址构建器，以及预置的
 * 「杨明明」档案。
 *
 * @module tests/people-helpers
 */

import type { ImPersonContact } from '../src/contract.ts'
import { ImPeople } from '../src/people.ts'
import type { ImPersonSaveRequest } from '../src/people.ts'
import type { ImLogger } from '../src/router.ts'
import { MemoryStore } from './memory-store.ts'

export const silent: ImLogger = { warn() {}, error() {} }

/** Build one fixed-clock ImPeople over a fresh memory store. */
/** 在全新内存存储上构建一只定准时钟的 ImPeople。 */
export function setup() {
  const store = new MemoryStore()
  let counter = 0
  const people = new ImPeople({
    store,
    logger: silent,
    now: () => 1_000,
    newId: prefix => `${prefix}-${++counter}`,
  })
  return { store, people }
}

/** Build one provider address with the suite's defaults. */
/** 以本套件的默认值构建一个 provider 地址。 */
export function address(accountId = 'acc-1', externalId = 'wxid-yang', conversationId = `p2p:${externalId}`) {
  return { provider: 'wechat', accountId, conversationId, externalId }
}

/** Seed the fully populated Yang Mingming profile and return it. */
/** 预置信息完整的「杨明明」档案并返回。 */
export async function seedYang(people: ImPeople, overrides: Partial<ImPersonSaveRequest> = {}) {
  return people.save({
    address: address(),
    displayName: '明明',
    realName: '杨明明',
    aliases: ['杨总', '小明'],
    contacts: [
      { kind: 'wechat', value: 'yang_mingming' },
      { kind: 'email', value: 'yang@example.com' },
    ],
    bio: '产品经理，负责 IM 渠道。',
    ...overrides,
  })
}

/** One contact list with a duplicate wechat value and a labeled phone. */
/** 一份带重复微信值与带标签电话的联系方式列表。 */
export const duplicateContacts: ImPersonContact[] = [
  { kind: 'wechat', value: 'yang_mingming' },
  { kind: 'wechat', value: ' YANG_MINGMING ' },
  { kind: 'phone', value: '13800138000', label: '工作' },
]
