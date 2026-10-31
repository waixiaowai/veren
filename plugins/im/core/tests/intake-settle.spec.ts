import { describe, expect, it } from 'vitest'
import { STRANGER_INTAKE_ASK } from '../src/intake.ts'
import { message, seedAccount, setup } from './intake-helpers.ts'

describe('automatic stranger intake (settle and audit)', () => {
  it('records a model-reported contact-only claim without inventing a name', async () => {
    const { store, people, router } = setup()
    await seedAccount(store)
    await router.handle('fake', message('m1', 'wxid-new', '在吗'))
    const person = people.list()[0]!
    await router.reportPersonClaim(person.id, {
      contacts: [{ kind: 'phone', value: '13800138000' }],
      accountId: 'acc',
      conversationId: 'p2p:wxid-new',
      messageId: 'im_person_report',
    })
    await router.settleIntake(person.id, 'answered', 'contact')
    const updated = people.list()[0]
    expect(updated?.claimedName).toBeUndefined()
    expect(updated?.claimedContacts).toEqual([{ kind: 'phone', value: '13800138000' }])
    expect(updated?.realName).toBeUndefined()
    expect(updated?.identityStatus).toBe('self-reported')
    expect(router.intakeStatus().recent[0]?.outcome).toBe('contact')
  })

  it('never rewrites or re-asks after a model settle, and settles only once', async () => {
    const { store, people, router } = setup()
    await seedAccount(store)
    await router.handle('fake', message('m1', 'wxid-new', '在吗'))
    const person = people.list()[0]!
    await router.reportPersonClaim(person.id, {
      name: '杨明明',
      accountId: 'acc',
      conversationId: 'p2p:wxid-new',
      messageId: 'im_person_report',
    })
    expect(await router.settleIntake(person.id, 'answered', 'name')).toBe(true)
    expect(await router.settleIntake(person.id, 'declined')).toBe(false)
    expect(people.intakeOf(person.id)?.status).toBe('answered')
  })

  it('closes the question as declined from the model and never asks again', async () => {
    const { store, service, people, router } = setup()
    await seedAccount(store)
    await router.handle('fake', message('m1', 'wxid-new', '在吗'))
    expect(service.sent).toHaveLength(1)
    const person = people.list()[0]
    expect(await router.settleIntake(person!.id, 'declined')).toBe(true)
    expect(people.intakeOf(person!.id)?.status).toBe('declined')
    await router.handle('fake', message('m3', 'wxid-new', '我叫王五'))
    expect(service.sent).toHaveLength(1)
    expect(people.list()[0]?.claimedName).toBeUndefined()
  })

  it('keeps a model-reported self-report out of every send when it collides with a verified name', async () => {
    const { store, service, people, router } = setup()
    await seedAccount(store)
    await people.save({
      address: {
        provider: 'fake',
        accountId: 'acc',
        conversationId: 'p2p:wxid-known',
        externalId: 'wxid-known',
      },
      displayName: '明明',
      realName: '杨明明',
    })
    await router.handle('fake', message('m1', 'wxid-new', '在吗'))
    const stranger = people.list().find(item => item.displayName === 'wxid-new')
    expect(stranger).toBeDefined()
    await router.reportPersonClaim(stranger!.id, {
      name: '杨明明',
      accountId: 'acc',
      conversationId: 'p2p:wxid-new',
      messageId: 'im_person_report',
    })
    expect(service.sent).toHaveLength(1)

    await expect(router.sendToPerson({
      person: '杨明明',
      content: { type: 'text', text: '在吗' },
    })).rejects.toMatchObject({
      code: 'IM_AMBIGUOUS',
      details: { query: '杨明明', status: 'ambiguous' },
    })
    expect(service.sent).toHaveLength(1)
    const resolution = people.resolve('杨明明')
    expect(resolution.status).toBe('ambiguous')
    if (resolution.status === 'ambiguous') {
      expect(resolution.candidates).toHaveLength(2)
      expect(resolution.candidates.map(item => item.person.identityStatus).sort())
        .toEqual(['self-reported', 'verified'])
    }
  })

  it('exposes the exact question and its audit trail after a model settle', async () => {
    const { store, people, router } = setup()
    await seedAccount(store)
    await router.handle('fake', message('m1', 'wxid-new', '在吗'))
    const person = people.list()[0]!
    await router.reportPersonClaim(person.id, {
      name: '杨明明',
      accountId: 'acc',
      conversationId: 'p2p:wxid-new',
      messageId: 'im_person_report',
    })
    await router.settleIntake(person.id, 'answered', 'name')
    const status = router.intakeStatus()
    expect(status.enabled).toBe(true)
    expect(status.askText).toBe(STRANGER_INTAKE_ASK)
    expect(status.counts.answered).toBe(1)
    expect(status.recent[0]).toMatchObject({
      status: 'answered',
      accountId: 'acc',
      conversationId: 'p2p:wxid-new',
      askText: STRANGER_INTAKE_ASK,
      outcome: 'name',
      claimedName: '杨明明',
    })
  })
})
