import { describe, expect, it } from 'vitest'
import { address, seedYang, setup } from './people-helpers.ts'

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
