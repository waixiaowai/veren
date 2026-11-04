import { describe, expect, it } from 'vitest'
import type { ImPersonContact } from '../src/contract.ts'
import { STRANGER_INTAKE_ASK } from '../src/intake.ts'
import { message, seedAccount, setup } from './intake-helpers.ts'

/** Claim wrapper mirroring the directory face the model tools call. */
/** 镜像模型工具调用的目录面 claim 包装。 */
function reportClaim(
  people: ReturnType<typeof setup>['people'],
  personId: string,
  claim: { name?: string; contacts?: ImPersonContact[] },
) {
  return people.recordClaim(personId, {
    ...(claim.name === undefined ? {} : { name: claim.name }),
    ...(claim.contacts === undefined ? {} : { contacts: claim.contacts }),
    provider: 'fake',
    accountId: 'acc',
    conversationId: 'p2p:wxid-new',
    messageId: 'im_person_report',
  })
}

describe('automatic stranger intake (settle and audit)', () => {
  it('records a model-reported contact-only claim without inventing a name', async () => {
    const { store, people, intake, handle } = setup()
    await seedAccount(store)
    await handle('fake', message('m1', 'wxid-new', '在吗'))
    const person = people.list()[0]!
    await reportClaim(people, person.id, {
      contacts: [{ kind: 'phone', value: '13800138000' }],
    })
    await intake.settleByModel(person.id, 'answered', 'contact')
    const updated = people.list()[0]
    expect(updated?.claimedName).toBeUndefined()
    expect(updated?.claimedContacts).toEqual([{ kind: 'phone', value: '13800138000' }])
    expect(updated?.realName).toBeUndefined()
    expect(updated?.identityStatus).toBe('self-reported')
    expect(intake.status().recent[0]?.outcome).toBe('contact')
  })

  it('never rewrites or re-asks after a model settle, and settles only once', async () => {
    const { store, people, intake, handle } = setup()
    await seedAccount(store)
    await handle('fake', message('m1', 'wxid-new', '在吗'))
    const person = people.list()[0]!
    await reportClaim(people, person.id, { name: '杨明明' })
    expect(await intake.settleByModel(person.id, 'answered', 'name')).toBe(true)
    expect(await intake.settleByModel(person.id, 'declined')).toBe(false)
    expect(people.intakeOf(person.id)?.status).toBe('answered')
  })

  it('closes the question as declined from the model and never asks again', async () => {
    const { store, service, people, intake, handle } = setup()
    await seedAccount(store)
    await handle('fake', message('m1', 'wxid-new', '在吗'))
    expect(service.sent).toHaveLength(1)
    const person = people.list()[0]
    expect(await intake.settleByModel(person!.id, 'declined')).toBe(true)
    expect(people.intakeOf(person!.id)?.status).toBe('declined')
    await handle('fake', message('m3', 'wxid-new', '我叫王五'))
    expect(service.sent).toHaveLength(1)
    expect(people.list()[0]?.claimedName).toBeUndefined()
  })

  it('keeps a claimed name out of exact resolution when it collides with a verified name', async () => {
    const { store, people, handle } = setup()
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
    await handle('fake', message('m1', 'wxid-new', '在吗'))
    const stranger = people.list().find(item => item.displayName === 'wxid-new')
    expect(stranger).toBeDefined()
    await reportClaim(people, stranger!.id, { name: '杨明明' })

    // A claimed name that collides with a verified person stays ambiguous in
    // resolution — it is never silently chosen.
    // 与已核实人员撞名的自述名在解析中保持歧义——绝不静默选中。
    const resolution = people.resolve('杨明明')
    expect(resolution.status).toBe('ambiguous')
    if (resolution.status === 'ambiguous') {
      expect(resolution.candidates).toHaveLength(2)
      expect(resolution.candidates.map(item => item.person.identityStatus).sort())
        .toEqual(['self-reported', 'verified'])
    }
  })

  it('exposes the exact question and its audit trail after a model settle', async () => {
    const { store, people, intake, handle } = setup()
    await seedAccount(store)
    await handle('fake', message('m1', 'wxid-new', '在吗'))
    const person = people.list()[0]!
    await reportClaim(people, person.id, { name: '杨明明' })
    await intake.settleByModel(person.id, 'answered', 'name')
    const status = intake.status()
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
