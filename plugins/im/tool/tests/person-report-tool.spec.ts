import { describe, expect, it } from 'vitest'
import { recordOf, setup } from './tool-helpers.ts'

describe('im_person_report tool', () => {
  it('writes a claim through the unverified path and leaves realName untouched', async () => {
    const { tools } = await setup()
    const created = recordOf(await tools.call('im_person_save', {
      accountId: 'acc-1',
      conversationId: 'p2p:wxid-yang',
      displayName: '明明',
    }))
    const id = recordOf(created.person).id as string
    const result = recordOf(await tools.call('im_person_report', {
      personId: id,
      name: '杨明明',
      contacts: [{ kind: 'phone', value: '13800138000' }],
      refused: false,
    }))
    expect(result.ok).toBe(true)
    expect(result.recorded).toBe(true)
    const person = recordOf(result.person)
    expect(person.claimedName).toBe('杨明明')
    expect(person.claimedContacts).toEqual([{ kind: 'phone', value: '13800138000' }])
    expect(person.identityStatus).toBe('self-reported')
    // The claim path must never touch the verified fields.
    // claim 路径绝不能碰已核实字段。
    expect(person.realName).toBeUndefined()
    expect(person.aliases).toEqual([])
    expect(person.displayName).toBe('明明')
  })

  it('drops a guardrail-failing name and says which field failed', async () => {
    const { tools, people } = await setup()
    const created = recordOf(await tools.call('im_person_save', {
      accountId: 'acc-1',
      conversationId: 'p2p:wxid-yang',
    }))
    const id = recordOf(created.person).id as string
    const result = recordOf(await tools.call('im_person_report', {
      personId: id,
      name: '我今年30岁',
      contacts: [{ kind: 'wechat', value: '1' }],
      refused: false,
    }))
    expect(result.ok).toBe(true)
    expect(result.recorded).toBe(false)
    const rejected = result.rejected as Array<Record<string, unknown>>
    expect(rejected.map(item => item.field).sort()).toEqual(['contacts', 'name'])
    const person = people.person(id)
    expect(person?.claimedName).toBeUndefined()
    expect(person?.identityStatus).toBe('unverified')
  })

  it('settles the open intake as declined on refused and records nothing', async () => {
    const { tools, people } = await setup()
    const created = recordOf(await tools.call('im_person_save', {
      accountId: 'acc-1',
      conversationId: 'p2p:wxid-yang',
    }))
    const id = recordOf(created.person).id as string
    await people.recordIntake({
      person_id: id,
      provider: 'fake',
      account_id: 'acc-1',
      conversation_id: 'p2p:wxid-yang',
      status: 'asked',
      asked_at: 1,
      ask_message_id: 'm-1',
      ask_text: 'ask',
    })
    const result = recordOf(await tools.call('im_person_report', {
      personId: id,
      name: '杨明明',
      refused: true,
    }))
    expect(result.ok).toBe(true)
    expect(result.recorded).toBe(false)
    expect(result.settled).toBe(true)
    expect(people.intakeOf(id)?.status).toBe('declined')
    expect(people.person(id)?.claimedName).toBeUndefined()
  })

  it('resolves the person from accountId + conversationId like the save tool', async () => {
    const { tools } = await setup()
    await tools.call('im_person_save', {
      accountId: 'acc-1',
      conversationId: 'p2p:wxid-yang',
      displayName: '明明',
    })
    const result = recordOf(await tools.call('im_person_report', {
      accountId: 'acc-1',
      conversationId: 'p2p:wxid-yang',
      name: '杨明明',
      refused: false,
    }))
    expect(result.ok).toBe(true)
    expect(result.recorded).toBe(true)
    const person = recordOf(result.person)
    expect(person.claimedName).toBe('杨明明')
    expect(person.realName).toBeUndefined()
  })
})
