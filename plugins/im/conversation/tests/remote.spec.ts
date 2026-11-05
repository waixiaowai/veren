/**
 * The conversation remote's wiring: the panel invites members through the
 * `imConv` namespace, so the endpoint name, gateway service key, and the
 * acting participant must match the browser-side definition — otherwise the
 * invite button silently does nothing while the domain tests stay green.
 *
 * 会话远端的接线：面板经 `imConv` 命名空间邀请成员，因此端点名、网关服务键与行动者必须与
 * 浏览器侧定义一致——否则邀请按钮会静默失效，而域测试全绿。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { ConvStorage } from '../src/store.ts'
import { RoomService } from '../src/rooms.ts'
import { PostService } from '../src/post.ts'
import { ReadService } from '../src/reads.ts'
import { ConversationFacade, ConversationToken } from '../src/service.ts'
import { ConversationRemoteService } from '../src/remote.ts'
import { MemoryTables } from './memory-tables.ts'

/** One context with a real facade and the conversation remote mounted on it. */
/** 一个装有真实门面与会话远端的 context。 */
function mounted(): { readonly facade: ConversationFacade; readonly remote: ConversationRemoteService } {
  const ctx = new Context()
  const store = new ConvStorage()
  store.attach(new MemoryTables())
  const rooms = new RoomService({ store, now: () => 1_000 })
  const post = new PostService({ store, rooms, now: () => 1_000 })
  const reads = new ReadService({ store, now: () => 1_000 })
  const facade = new ConversationFacade(rooms, post, reads)
  ctx.provide(ConversationToken, facade)
  return { facade, remote: new ConversationRemoteService(ctx) }
}

describe('conversation remote', () => {
  it('binds the imConv namespace to the imConversationGateway service', () => {
    const { remote } = mounted()
    expect(remote.typertRemote.namespace).toBe('imConv')
    expect(remote.typertRemote.serviceKey).toBe('imConversationGateway')
  })

  it('exports addMembers as a direct invocation', () => {
    const { remote } = mounted()
    const names = remoteMethods(remote).map(marker => marker.exportName ?? marker.method)
    expect(names).toContain('addMembers')
    const addMembers = remoteMethods(remote)
      .find(marker => (marker.exportName ?? marker.method) === 'addMembers')
    expect(addMembers?.invocation).toEqual({ kind: 'direct' })
  })

  it('seats the picked members as the workspace owner', async () => {
    const { facade, remote } = mounted()
    const room = await facade.createRoom({ kind: 'group', memberIds: ['human:owner'] })
    const { room: seated } = await remote.addMembers({
      roomId: room.id,
      memberIds: ['agent:reviewer', 'human:person-1'],
    })
    expect(seated.members).toEqual(['human:owner', 'agent:reviewer', 'human:person-1'])
  })

  it('passes the domain refusal through for a direct room', async () => {
    const { facade, remote } = mounted()
    const room = await facade.createRoom({ kind: 'direct', memberIds: ['human:owner', 'agent:default'] })
    await expect(remote.addMembers({ roomId: room.id, memberIds: ['agent:reviewer'] }))
      .rejects.toMatchObject({ code: 'STATE_CONFLICT' })
  })
})
