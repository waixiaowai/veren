/**
 * In-memory `ConvTables` fake for the conversation specs.
 *
 * 会话规格用的内存版 `ConvTables` 假实现。
 *
 * @module tests/memory-tables
 */

import type { ConvTable, ConvTables } from '../src/store.ts'
import type { ClientIdRow, CounterRow, MessageRow, ReadRow, RoomMemberRow, RoomRow } from '../src/rows.ts'

/** One map-backed table. */
/** 一只 Map 背书的表。 */
class MapTable<V> implements ConvTable<V> {
  constructor(readonly rows: Map<string, V> = new Map()) {}
  get(key: string): V | undefined {
    return this.rows.get(key)
  }
  async put(key: string, value: V): Promise<void> {
    this.rows.set(key, value)
  }
  async delete(key: string): Promise<boolean> {
    return this.rows.delete(key)
  }
  entries(): IterableIterator<[string, V]> {
    return this.rows.entries()
  }
}

/** The whole in-memory seam. */
/** 整个内存接缝。 */
export class MemoryTables implements ConvTables {
  readonly rooms = new MapTable<RoomRow>()
  readonly room_members = new MapTable<RoomMemberRow>()
  readonly messages = new MapTable<MessageRow>()
  readonly room_counters = new MapTable<CounterRow>()
  readonly room_reads = new MapTable<ReadRow>()
  readonly message_client_ids = new MapTable<ClientIdRow>()
}
