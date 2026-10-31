import { describe, expect, it } from 'vitest'
import { STRANGER_INTAKE_ASK } from '../src/intake.ts'
import { advance, message, seedAccount, setup } from './intake-helpers.ts'

describe('automatic stranger intake (ask side)', () => {
  it('asks once, and the model settles the question through the report path', async () => {
    const { store, service, people, router } = setup()
    await seedAccount(store)
    await router.handle('fake', message('m1', 'wxid-new', '在吗'))
    expect(service.sent).toHaveLength(1)
    expect(service.sent[0]?.target).toEqual({ accountId: 'acc', conversationId: 'p2p:wxid-new' })
    expect(service.sent[0]?.content).toEqual({ type: 'text', text: STRANGER_INTAKE_ASK })

    const person = people.list()[0]
    expect(person?.displayName).toBe('wxid-new')
    expect(person?.claimedName).toBeUndefined()
    expect(person?.identityStatus).toBe('unverified')

    // A raw reply is no longer parsed: nothing is written until the model
    // reports through the claim path.
    // 原始回复不再被解析：模型经 claim 路径回报之前，什么都不写。
    await router.handle('fake', message('m2', 'wxid-new', '我叫杨明明'))
    expect(service.sent).toHaveLength(1)
    expect(people.list()[0]?.claimedName).toBeUndefined()

    const claimed = await router.reportPersonClaim(person!.id, {
      name: '杨明明',
      accountId: 'acc',
      conversationId: 'p2p:wxid-new',
      messageId: 'im_person_report',
    })
    expect(claimed.realName).toBeUndefined()
    expect(claimed.aliases).toEqual([])
    expect(claimed.claimedName).toBe('杨明明')
    expect(claimed.identityStatus).toBe('self-reported')
    expect(await router.settleIntake(person!.id, 'answered', 'name')).toBe(true)

    const sent = await router.sendToPerson({
      person: '杨明明',
      content: { type: 'text', text: '在吗' },
    })
    expect(service.sent).toHaveLength(2)
    expect(service.sent[1]?.target).toEqual({ accountId: 'acc', conversationId: 'p2p:wxid-new' })
    expect(sent.recipient).toMatchObject({
      personId: claimed.id,
      matchedBy: 'claimedName',
      matchedValue: '杨明明',
      identityStatus: 'self-reported',
      claimedName: '杨明明',
      conversationId: 'p2p:wxid-new',
    })
  })

  it('does not ask again on a burst or after the display window', async () => {
    const { store, service, people, router } = setup({ replyWindowMs: 10_000 })
    await seedAccount(store)
    await router.handle('fake', message('m1', 'wxid-new', '在吗'))
    await router.handle('fake', message('m2', 'wxid-new', '在吗'))
    await router.handle('fake', message('m3', 'wxid-new', '在吗'))
    expect(service.sent).toHaveLength(1)

    advance(10_001)
    await router.handle('fake', message('m4', 'wxid-new', '我叫李四'))
    expect(service.sent).toHaveLength(1)
    const person = people.list()[0]
    // The window is display-only now: the row keeps `asked` until the model
    // settles it; it is shown as expired in the audit view.
    // 窗口现在只作展示：行保持 asked 直到模型收尾；审计视图里显示为 expired。
    expect(people.intakeOf(person!.id)?.status).toBe('asked')
    expect(router.intakeStatus().counts.expired).toBe(1)
  })

  it('never asks someone the directory can already identify', async () => {
    const { store, service, people, router } = setup()
    await seedAccount(store)
    await people.save({
      address: {
        provider: 'fake',
        accountId: 'acc',
        conversationId: 'p2p:wxid-known',
        externalId: 'wxid-known',
      },
      displayName: '小林',
    })
    await router.handle('fake', message('m1', 'wxid-known', '在吗'))
    expect(service.sent).toHaveLength(0)
    expect(people.list()).toHaveLength(1)
  })

  it('sends nothing at all when the total switch is off', async () => {
    const { store, service, people, router } = setup({ enabled: false })
    await seedAccount(store)
    await router.handle('fake', message('m1', 'wxid-new', '在吗'))
    expect(service.sent).toHaveLength(0)
    expect(people.list()[0]?.id).toBeDefined()
    expect(people.intakes()).toHaveLength(0)
    expect(router.intakeStatus().enabled).toBe(false)
  })

  it('caps questions per account across an hour', async () => {
    const { store, service, router } = setup({ maxAsksPerHour: 1 })
    await seedAccount(store)
    await router.handle('fake', message('m1', 'wxid-a', '在吗'))
    await router.handle('fake', message('m2', 'wxid-b', '在吗'))
    expect(service.sent).toHaveLength(1)
    expect(router.intakeStatus().counts.asked).toBe(1)
  })
})
