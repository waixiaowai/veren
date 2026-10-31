import { describe, expect, it } from 'vitest'
import { recordOf, setup } from './tool-helpers.ts'

describe('im_send by person', () => {
  it('sends to the unique match and reports the evidence', async () => {
    const { tools, fake } = await setup()
    await tools.call('im_person_save', {
      accountId: 'acc-1',
      conversationId: 'p2p:wxid-yang',
      displayName: '明明',
      realName: '杨明明',
    })
    const result = recordOf(await tools.call('im_send', { person: '杨明明', text: '在吗' }))
    expect(result.ok).toBe(true)
    expect(result.delivered).toBe(true)
    expect(recordOf(result.recipient)).toMatchObject({
      displayName: '明明',
      matchedBy: 'realName',
      matchedValue: '杨明明',
      accountId: 'acc-1',
      conversationId: 'p2p:wxid-yang',
    })
    expect(fake.sent).toHaveLength(1)
    expect(fake.sent[0]?.target).toEqual({ accountId: 'acc-1', conversationId: 'p2p:wxid-yang' })
  })

  it('refuses an ambiguous name, lists candidates, and sends nothing', async () => {
    const { tools, fake } = await setup()
    for (const id of ['wxid-a', 'wxid-b']) {
      await tools.call('im_person_save', {
        accountId: 'acc-1',
        conversationId: `p2p:${id}`,
        displayName: '杨明明',
      })
    }
    const result = recordOf(await tools.call('im_send', { person: '杨明明', text: '在吗' }))
    expect(result.ok).toBe(false)
    const error = recordOf(result.error)
    expect(error.code).toBe('IM_AMBIGUOUS')
    const details = recordOf(error.details)
    expect(details.candidates as unknown[]).toHaveLength(2)
    expect(fake.sent).toHaveLength(0)
  })

  it('reports not-found with suggestions and sends nothing', async () => {
    const { tools, fake } = await setup()
    await tools.call('im_person_save', {
      accountId: 'acc-1',
      conversationId: 'p2p:wxid-yang',
      displayName: '杨明明',
    })
    const result = recordOf(await tools.call('im_send', { person: '杨明', text: '在吗' }))
    expect(result.ok).toBe(false)
    const error = recordOf(result.error)
    expect(error.code).toBe('IM_NOT_FOUND')
    const details = recordOf(error.details)
    expect((details.suggestions as unknown[]).length).toBeGreaterThan(0)
    expect(fake.sent).toHaveLength(0)
  })

  it('rejects combining a person with an explicit conversation', async () => {
    const { tools } = await setup()
    const result = recordOf(await tools.call('im_send', {
      person: '杨明明',
      conversationId: 'p2p:wxid-yang',
      text: '在吗',
    }))
    expect(result.ok).toBe(false)
    expect(recordOf(result.error).code).toBe('IM_INVALID_REQUEST')
  })

  it('sends to a claimed name and reports its unverified source', async () => {
    const { tools, people, fake } = await setup()
    const created = recordOf(await tools.call('im_person_save', {
      accountId: 'acc-1',
      conversationId: 'p2p:wxid-unknown',
    }))
    await people.recordClaim(recordOf(created.person).id as string, {
      name: '杨明明',
      provider: 'fake',
      accountId: 'acc-1',
      conversationId: 'p2p:wxid-unknown',
      messageId: 'm-1',
    })
    const result = recordOf(await tools.call('im_send', { person: '杨明明', text: '在吗' }))
    expect(result.ok).toBe(true)
    expect(recordOf(result.recipient)).toMatchObject({
      matchedBy: 'claimedName',
      matchedValue: '杨明明',
      identityStatus: 'self-reported',
      claimedName: '杨明明',
    })
    expect(fake.sent).toHaveLength(1)
  })
})
