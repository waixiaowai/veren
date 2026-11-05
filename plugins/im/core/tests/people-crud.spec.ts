/**
 * Manual contact management: address-book creation, profile updates, and the
 * removal that takes addresses and the intake audit row with it.
 *
 * 手工联系人管理：通讯录新建、档案更新，以及连带地址与采集记录的删除。
 */

import { describe, expect, it } from 'vitest'
import { address, seedYang, setup } from './people-helpers.ts'

describe('ImPeople manual contacts', () => {
  it('creates an address-less contact from a profile alone', async () => {
    const { store, people } = setup()
    const created = await people.save({
      displayName: '小林',
      aliases: ['林工'],
      contacts: [{ kind: 'phone', value: '13800138000', label: '工作' }],
      notes: '前端同事',
    })
    expect(created.displayName).toBe('小林')
    expect(created.addresses).toEqual([])
    expect(created.contacts).toEqual([{ kind: 'phone', value: '13800138000', label: '工作' }])
    expect(created.notes).toBe('前端同事')
    expect(store.people()).toHaveLength(1)
  })

  it('requires a name when neither personId nor address is given', async () => {
    const { people } = setup()
    await expect(people.save({})).rejects.toMatchObject({ code: 'IM_INVALID_REQUEST' })
    await expect(people.save({ displayName: '   ' })).rejects.toMatchObject({ code: 'IM_INVALID_REQUEST' })
  })

  it('updates every editable field of an existing contact', async () => {
    const { people } = setup()
    const created = await people.save({ displayName: '小林' })
    const updated = await people.save({
      personId: created.id,
      realName: '林晓',
      aliases: ['林工'],
      contacts: [{ kind: 'email', value: 'lin@example.com' }],
      bio: '前端',
      notes: '周会认识',
    })
    expect(updated.realName).toBe('林晓')
    expect(updated.aliases).toEqual(['林工'])
    expect(updated.contacts).toEqual([{ kind: 'email', value: 'lin@example.com' }])
    expect(updated.bio).toBe('前端')
    expect(updated.notes).toBe('周会认识')
    expect(updated.identityStatus).toBe('verified')
    expect(people.list({ query: '周会' })).toHaveLength(1)
  })

  it('clears a field the editor emptied', async () => {
    const { people } = setup()
    const yang = await seedYang(people)
    const cleared = await people.save({ personId: yang.id, realName: '', notes: '' })
    expect(cleared.realName).toBeUndefined()
    expect(cleared.notes).toBeUndefined()
  })
})

describe('ImPeople removal', () => {
  it('drops the profile, its addresses, and its intake record', async () => {
    const { store, people } = setup()
    const yang = await seedYang(people)
    await people.recordIntake({
      person_id: yang.id,
      provider: 'wechat',
      account_id: 'acc-1',
      conversation_id: 'p2p:wxid-yang',
      status: 'asked',
      asked_at: 1_000,
      ask_message_id: 'msg-1',
      ask_text: '怎么称呼您？',
    })
    expect(store.personAddresses()).toHaveLength(1)

    await people.remove(yang.id)

    expect(store.people()).toHaveLength(0)
    expect(store.personAddresses()).toHaveLength(0)
    expect(store.intakes()).toHaveLength(0)
    expect(people.person(yang.id)).toBeUndefined()

    // 删掉的是联系人，不是历史：对方下次发消息会重新被收录成一条新档案。
    // Removing a contact keeps history: the next message registers them afresh.
    const again = await people.observeConversation(address())
    expect(again.id).not.toBe(yang.id)
  })

  it('rejects an unknown person and keeps the rest of the directory', async () => {
    const { people } = setup()
    await seedYang(people)
    await expect(people.remove('person-missing')).rejects.toMatchObject({ code: 'IM_NOT_FOUND' })
    expect(people.list()).toHaveLength(1)
  })
})
