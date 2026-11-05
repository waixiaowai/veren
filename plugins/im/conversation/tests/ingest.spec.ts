import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  DEFAULT_AGENT_PARTICIPANT_ID,
  ImPeople,
  agentParticipantId,
  channelRoomId,
  humanParticipantId,
} from '@veren/im'
import type { ImMessage, ImPersonAddressRow, ImPersonIntakeRow, ImPersonRow, ImPersonStore } from '@veren/im'
import { ConvStorage } from '../src/store.ts'
import { RoomService } from '../src/rooms.ts'
import { PostService } from '../src/post.ts'
import { Ingest } from '../src/ingest.ts'
import type { ImMessageNew } from '../src/events.ts'
import { MemoryTables } from './memory-tables.ts'

/** Minimal in-memory people seam; the ingest only reads and observes. */
/** 最小的人员接缝内存实现；吸收器只读取与观察。 */
class PersonMemory implements ImPersonStore {
  readonly personRows = new Map<string, ImPersonRow>()
  readonly addressRows = new Map<string, ImPersonAddressRow>()
  readonly intakeRows = new Map<string, ImPersonIntakeRow>()

  getPerson(id: string): ImPersonRow | undefined { return this.personRows.get(id) }
  people(): ImPersonRow[] { return [...this.personRows.values()] }
  async putPerson(row: ImPersonRow): Promise<void> { this.personRows.set(row.id, row) }
  async deletePerson(id: string): Promise<void> { this.personRows.delete(id) }
  getPersonAddress(provider: string, accountId: string, externalId: string): ImPersonAddressRow | undefined {
    return this.addressRows.get(`${provider}\u0000${accountId}\u0000${externalId}`)
  }
  personAddresses(): ImPersonAddressRow[] { return [...this.addressRows.values()] }
  async putPersonAddress(row: ImPersonAddressRow): Promise<void> {
    this.addressRows.set(`${row.provider}\u0000${row.account_id}\u0000${row.external_id}`, row)
  }
  async deletePersonAddressesOf(accountId: string): Promise<void> {
    for (const [key, row] of [...this.addressRows]) {
      if (row.account_id === accountId) this.addressRows.delete(key)
    }
  }
  async deletePersonAddressesOfPerson(personId: string): Promise<void> {
    for (const [key, row] of [...this.addressRows]) {
      if (row.person_id === personId) this.addressRows.delete(key)
    }
  }
  getIntake(personId: string): ImPersonIntakeRow | undefined { return this.intakeRows.get(personId) }
  intakes(): ImPersonIntakeRow[] { return [...this.intakeRows.values()] }
  async putIntake(row: ImPersonIntakeRow): Promise<void> { this.intakeRows.set(row.person_id, row) }
  async deleteIntake(personId: string): Promise<void> { this.intakeRows.delete(personId) }
}

let clock = 1_000
function message(id: string, text: string): ImMessage {
  clock += 1
  return {
    id,
    accountId: 'acc',
    conversationId: 'p2p:wxid-alice',
    sender: { id: 'wxid-alice' },
    sentAt: clock,
    content: { type: 'text', text },
  }
}

/** One silent logger shared by the fixtures. */
/** 夹具共用的静默日志器。 */
const silent = { info() {}, warn() {}, error() {} } as never

/** Assemble one ingest over fresh seams. */
/** 在全新接缝上组装一只吸收器。 */
function build(options: { channelAgentPreset?: string } = {}) {
  let counter = 0
  const ctx = new Context()
  const store = new ConvStorage()
  store.attach(new MemoryTables())
  const people = new ImPeople({ store: new PersonMemory(), logger: silent })
  const rooms = new RoomService({ store, now: () => clock })
  const seen: ImMessageNew[] = []
  ctx.on('im/message-new', payload => seen.push(payload))
  const post = new PostService({
    store,
    rooms,
    now: () => clock,
    newId: () => `msg-${++counter}`,
    committed: ({ room, message }) => { ctx.emit('im/message-new', { room, message }) },
  })
  const ingest = new Ingest({
    people,
    rooms,
    post,
    ...(options.channelAgentPreset === undefined ? {} : { channelAgentPreset: options.channelAgentPreset }),
  })
  return { store, rooms, post, participants: undefined, people, ingest, seen }
}

describe('channel ingest', () => {
  it('lands a provider observation in one deterministic channel room with seated members', async () => {
    const { store, post, people, ingest, seen } = build()
    await ingest.observe({ providerId: 'fake', message: message('m1', '你好') })
    const roomId = channelRoomId('fake', 'acc', 'p2p:wxid-alice')
    const posted = post.list({ roomId })
    expect(posted).toHaveLength(1)
    expect(posted[0]?.body).toBe('你好')
    expect(posted[0]?.clientId).toBe('m1')
    const room = store.getRoom(roomId)
    const sender = people.viewAt('fake', 'acc', 'p2p:wxid-alice')
    expect(room?.members).toContain(humanParticipantId(sender!.id))
    expect(room?.members).toContain(DEFAULT_AGENT_PARTICIPANT_ID)
    expect(seen).toHaveLength(1)
    expect(seen[0]?.message.id).toBe(posted[0]?.id)
  })

  it('replays a redelivered provider message idempotently and stays silent', async () => {
    const { post, ingest, seen } = build()
    await ingest.observe({ providerId: 'fake', message: message('m1', '你好') })
    await ingest.observe({ providerId: 'fake', message: message('m1', '你好') })
    expect(post.list({ roomId: channelRoomId('fake', 'acc', 'p2p:wxid-alice') })).toHaveLength(1)
    expect(seen).toHaveLength(1)
  })

  it('seats the preset-backed agent when config names one', async () => {
    const { store, ingest } = build({ channelAgentPreset: 'coder' })
    await ingest.observe({ providerId: 'fake', message: message('m1', '你好') })
    const room = store.getRoom(channelRoomId('fake', 'acc', 'p2p:wxid-alice'))
    expect(room?.members).toContain(agentParticipantId('coder'))
    expect(room?.members).not.toContain(DEFAULT_AGENT_PARTICIPANT_ID)
  })
})
