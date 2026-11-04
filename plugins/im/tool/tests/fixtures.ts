/**
 * Shared fixtures for the tool specs: the full family stack over memory seams
 * (conversation + coordination + a real TurnService with one scripted session
 * row), plus the fake tool-exec the specs hand to every tool.
 *
 * 工具规格的共享夹具：内存接缝上的完整家族栈（会话 + 协调 + 带一条脚本化会话行的真实
 * TurnService），外加每个工具都要用到的假 tool-exec。
 *
 * @module tests/fixtures
 */

import { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import {
  ImBindings, ImDirectory, ImPeople, ImParticipants, ImMemory, ImRegistry,
} from '@veren/im'
import type { ImMemoryRow, ImMemoryStore } from '@veren/im'
import type { ImPersonStore } from '@veren/im'
import { ConvStorage, ConversationFacade, PostService, ReadService, RoomService } from '@veren/im-conversation'
import type { ConvTable, ConvTables } from '@veren/im-conversation'
import type { MessageRow, ReadRow, RoomMemberRow, RoomRow, CounterRow, ClientIdRow } from '@veren/im-conversation'
import { BudgetRing, CoordinationService, Watermarks } from '@veren/im-coordination'
import type { WatermarkTable } from '@veren/im-coordination'
import { RunStore, TurnService } from '@veren/im-turn'
import type { AgentSessionRow, RunRow, RunEventRow, TurnTables } from '@veren/im-turn'
import { ImStrangerIntake } from '@veren/im'
import { TestStore } from './test-store.ts'

export const OWNER = 'human:owner'
export const ALICE = 'agent:alice'
export const ALICE_SESSION = 'session-alice'

/** One map-backed table. */
/** 一只 Map 背书的表。 */
class MapTable<V> implements ConvTable<V> {
  constructor(private readonly rows: Map<string, V> = new Map()) {}
  get(key: string): V | undefined { return this.rows.get(key) }
  async put(key: string, value: V): Promise<void> { this.rows.set(key, value) }
  async delete(key: string): Promise<boolean> { return this.rows.delete(key) }
  entries(): IterableIterator<[string, V]> { return this.rows.entries() }
}

/** The in-memory conversation seam. */
/** 内存版会话接缝。 */
class MemoryTables implements ConvTables {
  readonly rooms: ConvTable<RoomRow> = new MapTable<RoomRow>()
  readonly room_members: ConvTable<RoomMemberRow> = new MapTable<RoomMemberRow>()
  readonly messages: ConvTable<MessageRow> = new MapTable<MessageRow>()
  readonly room_counters: ConvTable<CounterRow> = new MapTable<CounterRow>()
  readonly room_reads: ConvTable<ReadRow> = new MapTable<ReadRow>()
  readonly message_client_ids: ConvTable<ClientIdRow> = new MapTable<ClientIdRow>()
}

/** One in-memory watermark table. */
/** 一只内存水位表。 */
class MemoryWatermarks implements WatermarkTable {
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

/** Memory run tables. */
/** 内存运行表。 */
class MemoryTurnTables implements TurnTables {
  readonly runRows = new Map<string, RunRow>()
  readonly eventRows = new Map<string, RunEventRow>()
  getRun(id: string) { return this.runRows.get(id) }
  runs() { return [...this.runRows.values()] }
  async putRun(row: RunRow): Promise<void> { this.runRows.set(row.id, row) }
  events() { return [...this.eventRows.values()] }
  async putEvent(row: RunEventRow): Promise<void> { this.eventRows.set(row.id, row) }
}

/** The fake exec: one call attributed to Alice's session in Alice's room. */
/** 假 exec：一次归属到 Alice 会话与 Alice 房间的调用。 */
export function execOf(): ToolRunContext {
  return {
    agent: { session: { id: ALICE_SESSION } },
  } as never
}

/** Assemble one tool-facing stack over memory seams. */
/** 在内存接缝上组装一只面向工具的栈。 */
export function build() {
  let clock = 1_000
  let counter = 0
  const ctx = new Context()
  const store = new TestStore()
  // The one account every fixture routes through (claims resolve through it).
  // 所有夹具都经过的那只账号（自述经它解析 provider）。
  void store.putAccount({ id: 'acc', provider: 'fake', token_ref: 'im/x' })
  const people = new ImPeople({ store, logger: { warn() {}, error() {} }, now: () => clock })
  const participants = new ImParticipants({
    roster: [{ presetId: 'alice', name: '爱丽丝' }],
    ownerName: 'Owner',
    people,
  })
  const credentials = { async remove() {} }
  const service = {
    async start() {}, async stop() {}, async accounts() { return [] },
    listen: () => () => {},
    async bind() { throw new Error('no bind in fixtures') },
    async send(_request: unknown) { return { id: 's1', sentAt: clock } },
  }
  const registry = new ImRegistry(ctx, undefined, people)
  registry.register({ id: 'fake', displayName: 'Fake', features: {
    direct: true, group: false, threads: false, markdown: false,
    media: { image: false, file: false }, typing: false, auth: ['qrcode'], limits: {},
  }, service: service as never })
  const bindings = new ImBindings({ store, registry, logger: { warn() {}, error() {} } })
  const directory = new ImDirectory({ bindings, people })
  const intake = new ImStrangerIntake({
    people,
    logger: { warn() {}, error() {} },
    config: { enabled: true },
    send: async request => service.send({
      target: { accountId: request.accountId, conversationId: request.conversationId },
      content: { type: 'text', text: request.text },
    }) as never,
  })

  const convStore = new ConvStorage()
  convStore.attach(new MemoryTables())
  const rooms = new RoomService({ store: convStore, now: () => clock })
  const post = new PostService({ store: convStore, rooms, now: () => clock, newId: () => `msg-${++counter}` })
  const reads = new ReadService({ store: convStore, now: () => clock })
  const conversation = new ConversationFacade(rooms, post, reads)
  const watermarkTable = new MemoryWatermarks()
  const watermarks = new Watermarks(() => clock)
  watermarks.attach(watermarkTable)
  const coordination = new CoordinationService({
    conversation,
    participants,
    watermarks,
    budget: new BudgetRing(100, 60_000, () => clock),
  })
  const turnTables = new MemoryTurnTables()
  const runs = new RunStore(() => clock)
  runs.attach(turnTables)
  // Alice's session maps to the room the specs create; the row key uses the
  // same \u0000 separator the turn domain persists.
  // Alice 的会话映射到规格创建的房间；行键使用回合域持久化的同一个 \u0000 分隔符。
  let aliceRoomId = ''
  const sessionRows = (): AgentSessionRow[] => [
    { key: `${ALICE}\u0000${aliceRoomId}`, session_id: ALICE_SESSION, updated_at: clock },
  ]
  const turn = new TurnService(runs, sessionRows)
  const memory = new ImMemory({ store: memoryOver(), now: () => clock })
  return {
    ctx, registry, bindings, directory, intake, people, participants, credentials,
    conversation, rooms, post, coordination, runs, memory, turn,
    setAliceRoom: (roomId: string) => { aliceRoomId = roomId },
  }
}

/** One minimal in-memory person seam. */
/** 一只最小的人员接缝内存实现。 */
export type PersonSeam = ImPersonStore

/**
 * Adapter: one fresh in-memory ImMemoryStore (the shared TestStore predates
 * the memories table).
 * 适配器：一只全新的内存 ImMemoryStore（共享的 TestStore 早于 memories 表）。
 */
function memoryOver(): ImMemoryStore {
  const rows = new Map<string, ImMemoryRow>()
  return {
    getMemory: id => rows.get(id),
    memories: () => [...rows.values()],
    putMemory: async row => { rows.set(row.id, row) },
    deleteMemory: async id => { rows.delete(id) },
  }
}
