import { describe, expect, it } from 'vitest'
import type { ImPersonContact } from '../src/contract.ts'
import { ImPeople } from '../src/people.ts'
import type { ImPersonSaveRequest } from '../src/people.ts'
import type { ImLogger } from '../src/router.ts'
import { MemoryStore } from './memory-store.ts'

const silent: ImLogger = { warn() {}, error() {} }

function setup() {
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

function address(accountId = 'acc-1', externalId = 'wxid-yang', conversationId = `p2p:${externalId}`) {
  return { provider: 'wechat', accountId, conversationId, externalId }
}

async function seedYang(people: ImPeople, overrides: Partial<ImPersonSaveRequest> = {}) {
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

describe('ImPeople resolution', () => {
  it('matches by real name, nickname, alias, contact, address, and person id', async () => {
    const { people } = setup()
    const yang = await seedYang(people)
    expect(people.resolve('杨明明')).toMatchObject({
      status: 'matched',
      match: { matchedBy: 'realName', matchedValue: '杨明明' },
    })
    expect(people.resolve('明明')).toMatchObject({
      status: 'matched',
      match: { matchedBy: 'displayName', matchedValue: '明明' },
    })
    expect(people.resolve('杨总')).toMatchObject({
      status: 'matched',
      match: { matchedBy: 'alias', matchedValue: '杨总' },
    })
    expect(people.resolve('yang_mingming')).toMatchObject({
      status: 'matched',
      match: { matchedBy: 'contact', matchedValue: 'wechat:yang_mingming' },
    })
    expect(people.resolve('p2p:wxid-yang')).toMatchObject({
      status: 'matched',
      match: { matchedBy: 'address' },
    })
    expect(people.resolve(yang.id)).toMatchObject({
      status: 'matched',
      match: { matchedBy: 'id', matchedValue: yang.id },
    })
  })

  it('matches a person who only has a nickname', async () => {
    const { people } = setup()
    await people.save({ address: address(), displayName: '小林' })
    const resolution = people.resolve('小林')
    expect(resolution.status).toBe('matched')
    if (resolution.status === 'matched') {
      expect(resolution.match.person.realName).toBeUndefined()
      expect(resolution.match.matchedBy).toBe('displayName')
    }
  })

  it('returns one match when several names point at the same person', async () => {
    const { people } = setup()
    const yang = await seedYang(people)
    for (const query of ['杨明明', '明明', '杨总', '小明']) {
      const resolution = people.resolve(query)
      expect(resolution.status).toBe('matched')
      if (resolution.status === 'matched') expect(resolution.match.person.id).toBe(yang.id)
    }
  })

  it('refuses two people with the same name', async () => {
    const { people } = setup()
    await people.save({ address: address('acc-1', 'wxid-a'), displayName: '杨明明' })
    await people.save({ address: address('acc-1', 'wxid-b'), displayName: '杨明明' })
    const resolution = people.resolve('杨明明')
    expect(resolution.status).toBe('ambiguous')
    if (resolution.status === 'ambiguous') {
      expect(resolution.candidates).toHaveLength(2)
      expect(resolution.candidates.every(item => item.matchedBy === 'displayName')).toBe(true)
    }
  })

  it('does not promote a partial name and suggests close names', async () => {
    const { people } = setup()
    await seedYang(people)
    const resolution = people.resolve('杨明')
    expect(resolution.status).toBe('not-found')
    if (resolution.status === 'not-found') {
      expect(resolution.suggestions.map(person => person.displayName)).toContain('明明')
    }
  })

  it('matches phone contacts regardless of separators', async () => {
    const { people } = setup()
    await people.save({
      address: address(),
      displayName: '小林',
      contacts: [{ kind: 'phone', value: '+86 138-0013-8000' }],
    })
    expect(people.resolve('13800138000')).toMatchObject({
      status: 'matched',
      match: { matchedBy: 'contact' },
    })
  })
})

describe('ImPeople addresses', () => {
  it('keeps several addresses on one person and filters by account', async () => {
    const { people } = setup()
    const yang = await seedYang(people)
    await people.save({
      personId: yang.id,
      address: address('acc-2', 'wxid-yang-2', 'p2p:wxid-yang-2'),
    })
    expect(people.addressesOf(yang.id)).toHaveLength(2)
    expect(people.addressesOf(yang.id, { accountId: 'acc-2' })).toHaveLength(1)
    expect(people.list({ query: '杨明明', accountId: 'acc-2' })).toHaveLength(1)
    expect(people.list({ query: '杨明明', accountId: 'missing' })).toHaveLength(0)
  })

  it('rejects attaching one address to a second person', async () => {
    const { people } = setup()
    await seedYang(people)
    const other = await people.save({ address: address('acc-9', 'wxid-other'), displayName: '别人' })
    await expect(people.save({
      personId: other.id,
      address: address(),
    })).rejects.toMatchObject({ code: 'IM_INVALID_REQUEST' })
  })
})

describe('ImPeople observation', () => {
  it('registers one inbound sender once and fills identity data later', async () => {
    const { store, people } = setup()
    const first = await people.observeConversation(address())
    const second = await people.observeConversation(address())
    expect(second.id).toBe(first.id)
    expect(store.people()).toHaveLength(1)
    expect(store.personAddresses()).toHaveLength(1)
    expect(first.displayName).toBe('wxid-yang')
    expect(first.contacts).toEqual([{ kind: 'wechat', value: 'wxid-yang' }])

    const named = await people.save({
      personId: first.id,
      realName: '杨明明',
      aliases: ['杨总'],
      bio: '同事',
    })
    expect(named.realName).toBe('杨明明')
    expect(people.resolve('杨明明').status).toBe('matched')
  })

  it('never overwrites a human-chosen nickname with a provider name', async () => {
    const { people } = setup()
    const observed = await people.observeConversation({ ...address(), displayName: '旧昵称' })
    await people.save({ personId: observed.id, displayName: '杨明明' })
    const again = await people.observeConversation({ ...address(), displayName: '另一个昵称' })
    expect(again.displayName).toBe('杨明明')
  })

  it('serializes concurrent observations of one address', async () => {
    const { store, people } = setup()
    await Promise.all([
      people.observeConversation(address()),
      people.observeConversation(address()),
      people.observeConversation(address()),
    ])
    expect(store.people()).toHaveLength(1)
    expect(store.personAddresses()).toHaveLength(1)
  })

  it('updates one address conversation without cloning the person', async () => {
    const { store, people } = setup()
    const first = await people.observeConversation(address('acc-1', 'wxid-yang', 'p2p:wxid-yang'))
    const second = await people.observeConversation(address('acc-1', 'wxid-yang', 'p2p:renamed'))
    expect(second.id).toBe(first.id)
    expect(store.people()).toHaveLength(1)
    expect(store.personAddresses()).toHaveLength(1)
    expect(people.addressesOf(first.id)[0]?.conversationId).toBe('p2p:renamed')
  })

  it('repairs an address whose person row is missing', async () => {
    const { store, people } = setup()
    const observed = await people.observeConversation(address())
    store.personRows.delete(observed.id)
    const repaired = await people.observeConversation(address())
    expect(repaired.id).not.toBe(observed.id)
    expect(store.people()).toHaveLength(1)
  })
})

describe('ImPeople listing', () => {
  it('lists every person and filters by query', async () => {
    const { people } = setup()
    await seedYang(people)
    await people.save({ address: address('acc-1', 'wxid-lin'), displayName: '小林' })
    expect(people.list()).toHaveLength(2)
    expect(people.list({ query: '杨' }).map(person => person.displayName)).toEqual(['明明'])
    expect(people.list({ query: 'wxid-yang' })).toHaveLength(1)
  })

  it('deduplicates aliases and contacts while keeping labels', async () => {
    const { people } = setup()
    const contacts: ImPersonContact[] = [
      { kind: 'wechat', value: 'yang_mingming' },
      { kind: 'wechat', value: ' YANG_MINGMING ' },
      { kind: 'phone', value: '13800138000', label: '工作' },
    ]
    const person = await seedYang(people, { aliases: ['杨总', ' 杨总 '], contacts })
    expect(person.aliases).toEqual(['杨总'])
    expect(person.contacts).toHaveLength(2)
    expect(person.contacts[1]?.label).toBe('工作')
  })
})
