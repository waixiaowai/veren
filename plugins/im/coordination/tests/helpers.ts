/**
 * Shared fixtures for the coordination specs: an in-memory watermark table, a
 * real conversation facade over memory tables, and a canned roster.
 *
 * 协调规格的共享夹具：内存水位表、内存表之上的真实会话门面，以及罐头名册。
 *
 * @module tests/helpers
 */

import { ImPeople, ImParticipants, agentParticipantId } from '@veren/im'
import type { ImPersonStore } from '@veren/im'
import { ConvStorage, ConversationFacade, PostService, ReadService, RoomService } from '@veren/im-conversation'
import type { WatermarkTable } from '../src/watermarks.ts'
import { Watermarks } from '../src/watermarks.ts'
import { BudgetRing } from '../src/budget.ts'
import { CoordinationService } from '../src/service.ts'
import { MemoryTables } from '../../conversation/tests/memory-tables.ts'

/** One in-memory watermark table. */
/** 一只内存水位表。 */
export class MemoryWatermarks implements WatermarkTable {
  readonly rows = new Map<string, { agent_id: string; room_id: string; watermark: number; updated_at: number }>()
  get(key: string) { return this.rows.get(key) }
  async put(key: string, value: { agent_id: string; room_id: string; watermark: number; updated_at: number }): Promise<void> {
    this.rows.set(key, value)
  }
  async delete(key: string): Promise<boolean> { return this.rows.delete(key) }
  entries(): IterableIterator<[string, { agent_id: string; room_id: string; watermark: number; updated_at: number }]> {
    return this.rows.entries()
  }
}

/** Minimal in-memory people seam (the roster only reads it). */
/** 最小的人员接缝内存实现（名册只读取它）。 */
class PersonMemory implements ImPersonStore {
  readonly rows = new Map<string, never>()
  getPerson(id: string) { return this.rows.get(id) }
  people() { return [...this.rows.values()] }
  async putPerson(): Promise<void> {}
  async deletePerson(): Promise<void> {}
  getPersonAddress(): undefined { return undefined }
  personAddresses() { return [] }
  async putPersonAddress(): Promise<void> {}
  async deletePersonAddressesOf(): Promise<void> {}
  getIntake(): undefined { return undefined }
  intakes() { return [] }
  async putIntake(): Promise<void> {}
  async deleteIntake(): Promise<void> {}
}

export const OWNER = 'human:owner'
export const ALICE = 'agent:alice'
export const BOB = 'agent:bob'

/** Assemble one full coordination stack over memory seams. */
/** 在内存接缝上组装一整只协调栈。 */
export function build(options: { budget?: number } = {}) {
  let clock = 1_000
  let counter = 0
  const store = new ConvStorage()
  store.attach(new MemoryTables())
  const people = new ImPeople({ store: new PersonMemory(), logger: { warn() {}, error() {} } })
  const participants = new ImParticipants({
    roster: [{ presetId: 'alice', name: '爱丽丝' }, { presetId: 'bob', name: '鲍勃' }],
    ownerName: 'Owner',
    people,
  })
  const rooms = new RoomService({ store, now: () => clock })
  const post = new PostService({ store, rooms, now: () => clock, newId: () => `msg-${++counter}` })
  const reads = new ReadService({ store, now: () => clock })
  const conversation = new ConversationFacade(rooms, post, reads)
  const watermarks = new Watermarks(() => clock)
  watermarks.attach(new MemoryWatermarks())
  const coordination = new CoordinationService({
    conversation,
    participants,
    watermarks,
    budget: new BudgetRing(options.budget ?? 100, 60_000, () => clock),
  })
  return {
    conversation, rooms, post, coordination, watermarks, participants, people,
    advanceClock: (ms: number) => { clock += ms },
    ids: { alice: agentParticipantId('alice'), bob: agentParticipantId('bob') },
  }
}
