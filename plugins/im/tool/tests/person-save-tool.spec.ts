import { describe, expect, it } from 'vitest'
import { recordOf, setup } from './tool-helpers.ts'

describe('im_person_save tool', () => {
  it('creates a person from an address and exposes every identity field', async () => {
    const { tools } = await setup()
    const saved = recordOf(await tools.call('im_person_save', {
      accountId: 'acc-1',
      conversationId: 'p2p:wxid-yang',
      displayName: '明明',
      realName: '杨明明',
      aliases: ['杨总', '小明'],
      contacts: [{ kind: 'wechat', value: 'yang_mingming' }],
      bio: '产品经理',
    }))
    expect(saved.ok).toBe(true)
    const person = recordOf(saved.person)
    expect(person.realName).toBe('杨明明')
    expect(person.aliases).toEqual(['杨总', '小明'])
    expect(person.contacts).toEqual([{ kind: 'wechat', value: 'yang_mingming' }])

    const listed = recordOf(await tools.call('im_people', {}))
    expect(listed.ok).toBe(true)
    const people = listed.people as Array<Record<string, unknown>>
    expect(people).toHaveLength(1)
    expect(people[0]?.displayName).toBe('明明')
    expect(people[0]?.realName).toBe('杨明明')
    expect((people[0]?.addresses as Array<Record<string, unknown>>)[0]?.externalId).toBe('wxid-yang')
  })

  it('updates an existing person by id without moving their address', async () => {
    const { tools } = await setup()
    const created = recordOf(await tools.call('im_person_save', {
      accountId: 'acc-1',
      conversationId: 'p2p:wxid-yang',
      displayName: '明明',
    }))
    const id = recordOf(created.person).id
    const updated = recordOf(await tools.call('im_person_save', {
      personId: id,
      realName: '杨明明',
      notes: 'IM 渠道对接人',
    }))
    expect(updated.ok).toBe(true)
    expect(recordOf(updated.person).realName).toBe('杨明明')
    expect(recordOf(updated.person).displayName).toBe('明明')
  })

  it('rejects creating a person without an address or an id', async () => {
    const { tools } = await setup()
    const result = recordOf(await tools.call('im_person_save', { displayName: '无名氏' }))
    expect(result.ok).toBe(false)
    expect(recordOf(result.error).code).toBe('IM_INVALID_REQUEST')
  })

  it('rejects an address that already belongs to another person', async () => {
    const { tools } = await setup()
    await tools.call('im_person_save', {
      accountId: 'acc-1',
      conversationId: 'p2p:wxid-yang',
      displayName: '明明',
    })
    const second = recordOf(await tools.call('im_person_save', {
      accountId: 'acc-1',
      conversationId: 'p2p:wxid-other',
      displayName: '别人',
    }))
    const result = recordOf(await tools.call('im_person_save', {
      personId: recordOf(second.person).id,
      accountId: 'acc-1',
      conversationId: 'p2p:wxid-yang',
    }))
    expect(result.ok).toBe(false)
    expect(recordOf(result.error).code).toBe('IM_INVALID_REQUEST')
  })

  it('clears an unverified self-report through clearClaim', async () => {
    const { tools, people } = await setup()
    const created = recordOf(await tools.call('im_person_save', {
      accountId: 'acc-1',
      conversationId: 'p2p:wxid-yang',
      displayName: '明明',
    }))
    const id = recordOf(created.person).id as string
    await people.recordClaim(id, {
      name: '杨明明',
      provider: 'fake',
      accountId: 'acc-1',
      conversationId: 'p2p:wxid-yang',
      messageId: 'm-1',
    })
    const cleared = recordOf(await tools.call('im_person_save', { personId: id, clearClaim: true }))
    expect(cleared.ok).toBe(true)
    expect(recordOf(cleared.person).claimedName).toBeUndefined()
    expect(recordOf(cleared.person).identityStatus).toBe('unverified')
  })
})
