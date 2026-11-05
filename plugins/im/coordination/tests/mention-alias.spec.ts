import { describe, expect, it } from 'vitest'
import { OWNER, build } from './helpers.ts'

/**
 * Mention routing accepts the localized name the panel shows: the default agent
 * is named "Assistant" on the host but the panel's mention picker inserts
 * "助手", and a group message has to wake it anyway.
 * 提及路由接受面板显示的本地化名字：宿主上默认智能体叫 Assistant，但面板的提选择器插入
 * 「助手」，群聊里这句话必须照样唤醒它。
 */
describe('mention routing across localized names', () => {
  it('wakes the default agent on the localized mention', async () => {
    const { rooms, coordination, participants } = build()
    const room = await rooms.createRoom({ kind: 'group', memberIds: [OWNER, 'agent:default'] })
    const verdict = coordination.triage({
      roomId: room.id,
      authorId: OWNER,
      body: '@助手 请回一句',
      candidateId: 'agent:default',
    })
    expect(verdict).toEqual({ actionable: true, source: 'mentioned' })
    expect(participants.resolve('agent:default')?.aliases).toContain('助手')
  })

  it('keeps the group quiet when nobody is named', async () => {
    const { rooms, coordination } = build()
    const room = await rooms.createRoom({ kind: 'group', memberIds: [OWNER, 'agent:default'] })
    const verdict = coordination.triage({
      roomId: room.id,
      authorId: OWNER,
      body: '这句话没有提及任何人',
      candidateId: 'agent:default',
    })
    expect(verdict).toEqual({ actionable: false, source: 'group-quiet' })
  })
})
