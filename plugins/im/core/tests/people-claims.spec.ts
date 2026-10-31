import { describe, expect, it } from 'vitest'
import { address, setup } from './people-helpers.ts'

describe('ImPeople self-reports', () => {
  it('keeps a claim separate from verified identity and human corrections', async () => {
    const { people } = setup()
    const observed = await people.observeConversation(address())
    const claimed = await people.recordClaim(observed.id, {
      name: '杨明明',
      contacts: [{ kind: 'phone', value: '13800138000' }],
      provider: 'wechat',
      accountId: 'acc-1',
      conversationId: 'p2p:wxid-yang',
      messageId: 'm-1',
    })
    expect(claimed.realName).toBeUndefined()
    expect(claimed.displayName).toBe('wxid-yang')
    expect(claimed.claimedName).toBe('杨明明')
    expect(claimed.claimedContacts).toEqual([{ kind: 'phone', value: '13800138000' }])
    expect(claimed.identityStatus).toBe('self-reported')

    const verified = await people.save({
      personId: observed.id,
      realName: '杨明明',
      displayName: '明明',
    })
    expect(verified.realName).toBe('杨明明')
    expect(verified.claimedName).toBe('杨明明')
    expect(verified.identityStatus).toBe('verified')

    const cleared = await people.save({ personId: observed.id, clearClaim: true })
    expect(cleared.claimedName).toBeUndefined()
    expect(cleared.claimedContacts).toEqual([])
    expect(cleared.realName).toBe('杨明明')
    expect(cleared.identityStatus).toBe('verified')
  })

  it('keeps the first self-report and never lets a later one rewrite it', async () => {
    const { people } = setup()
    const observed = await people.observeConversation(address())
    const claim = {
      name: '杨明明',
      provider: 'wechat',
      accountId: 'acc-1',
      conversationId: 'p2p:wxid-yang',
      messageId: 'm-1',
    }
    await people.recordClaim(observed.id, claim)
    const again = await people.recordClaim(observed.id, { ...claim, name: '别人', messageId: 'm-2' })
    expect(again.claimedName).toBe('杨明明')
  })

  it('matches a claimed name and a claimed contact without promoting either', async () => {
    const { people } = setup()
    const observed = await people.observeConversation(address())
    await people.recordClaim(observed.id, {
      name: '杨明明',
      contacts: [{ kind: 'phone', value: '13800138000' }],
      provider: 'wechat',
      accountId: 'acc-1',
      conversationId: 'p2p:wxid-yang',
      messageId: 'm-1',
    })
    expect(people.resolve('杨明明')).toMatchObject({
      status: 'matched',
      match: { matchedBy: 'claimedName', person: { identityStatus: 'self-reported' } },
    })
    expect(people.resolve('13800138000')).toMatchObject({
      status: 'matched',
      match: { matchedBy: 'claimedContact' },
    })
  })

  it('treats a claimed name that collides with a confirmed display name as ambiguous', async () => {
    const { people } = setup()
    await people.save({ address: address('acc-1', 'wxid-known'), displayName: '杨明明' })
    const stranger = await people.observeConversation(address('acc-1', 'wxid-new'))
    await people.recordClaim(stranger.id, {
      name: '杨明明',
      provider: 'wechat',
      accountId: 'acc-1',
      conversationId: 'p2p:wxid-new',
      messageId: 'm-1',
    })
    const resolution = people.resolve('杨明明')
    expect(resolution.status).toBe('ambiguous')
    if (resolution.status === 'ambiguous') {
      expect(resolution.candidates).toHaveLength(2)
      expect(resolution.candidates.map(item => item.matchedBy).sort()).toEqual(['claimedName', 'displayName'])
    }
  })
})
