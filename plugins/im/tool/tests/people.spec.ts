import { describe, expect, it } from 'vitest'
import { ALICE, build, execOf } from './fixtures.ts'
import { imPersonReportTool } from '../src/report-tool.ts'
import { peopleTools } from '../src/people-tools.ts'

/** Seat one direct room and one observed stranger. */
/** 安排一间直聊房与一个被观察的陌生人。 */
async function roomWith() {
  const stack = build()
  const room = await stack.rooms.createRoom({ kind: 'direct', memberIds: [ALICE] })
  stack.setAliceRoom(room.id)
  return { stack, roomId: room.id }
}

describe('directory and intake tools', () => {
  it('im_people lists the directory; im_person_save enriches', async () => {
    const { stack } = await roomWith()
    const [list, save] = peopleTools(stack.directory, stack.intake)
    await stack.people.save({
      address: { provider: 'fake', accountId: 'acc', conversationId: 'p2p:wxid-bob', externalId: 'wxid-bob' },
      displayName: '小鲍',
    })
    const listed = await list.execute({}, execOf()) as { ok: boolean; people: Array<{ id: string; displayName: string }> }
    expect(listed.ok).toBe(true)
    expect(listed.people.map(p => p.displayName)).toContain('小鲍')
    const saved = await save.execute({ personId: listed.people[0]?.id, realName: '鲍小明', aliases: ['Bob'] }, execOf()) as { ok: boolean; person: { realName?: string; aliases: string[] } }
    expect(saved.ok).toBe(true)
    expect(saved.person.realName).toBe('鲍小明')
    expect(saved.person.aliases).toContain('Bob')
  })

  it('im_person_report records only the unverified claim and settles the intake', async () => {
    const { stack } = await roomWith()
    await stack.people.observeConversation({
      provider: 'fake', accountId: 'acc', conversationId: 'p2p:wxid-stranger', externalId: 'wxid-stranger',
    })
    const stranger = stack.people.viewAt('fake', 'acc', 'p2p:wxid-stranger')
    expect(stranger).toBeDefined()
    await stack.people.recordIntake({
      person_id: stranger!.id, provider: 'fake', account_id: 'acc', conversation_id: 'p2p:wxid-stranger',
      status: 'asked', asked_at: 1, ask_message_id: 'ask-1', ask_text: '怎么称呼？',
    })
    const tool = imPersonReportTool({ directory: stack.directory, intake: stack.intake })
    const result = await tool.execute({
      personId: stranger!.id,
      name: '杨明明',
      contacts: [{ kind: 'phone', value: '13800138000' }],
      refused: false,
    }, execOf()) as { ok: boolean; recorded: boolean; person: { claimedName?: string; realName?: string } }
    expect(result.ok).toBe(true)
    expect(result.recorded).toBe(true)
    expect(result.person.claimedName).toBe('杨明明')
    // The claim path never touches the verified fields.
    // 自述路径绝不触碰已核实字段。
    expect(result.person.realName).toBeUndefined()
    const intake = stack.people.intakeOf(stranger!.id)
    expect(intake?.status).toBe('answered')
  })

  it('im_person_report with refused=true closes the question without recording', async () => {
    const { stack } = await roomWith()
    await stack.people.observeConversation({
      provider: 'fake', accountId: 'acc', conversationId: 'p2p:wxid-shy', externalId: 'wxid-shy',
    })
    const shy = stack.people.viewAt('fake', 'acc', 'p2p:wxid-shy')!
    await stack.people.recordIntake({
      person_id: shy.id, provider: 'fake', account_id: 'acc', conversation_id: 'p2p:wxid-shy',
      status: 'asked', asked_at: 1, ask_message_id: 'ask-1', ask_text: '怎么称呼？',
    })
    const tool = imPersonReportTool({ directory: stack.directory, intake: stack.intake })
    const result = await tool.execute({ personId: shy.id, refused: true }, execOf()) as { ok: boolean; declined: boolean }
    expect(result.ok).toBe(true)
    expect(result.declined).toBe(true)
    expect(stack.people.intakeOf(shy.id)?.status).toBe('declined')
    expect(stack.people.person(shy.id)?.claimedName).toBeUndefined()
  })
})
