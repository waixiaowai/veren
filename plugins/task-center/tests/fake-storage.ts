/**
 * 内存存储后端（测试基建）：`StorageBackend`/`KvUnit` 契约的 Map 实现，零落盘。
 * In-memory storage backend (test infrastructure): a Map implementation of the
 * `StorageBackend`/`KvUnit` contract with zero disk IO.
 *
 * 给"只测服务语义、不测持久化"的用例用（批量建树的安全上限等）：真实 hub 与
 * domain 层照常运转，只有介质换成内存——用例时长不再受磁盘 fsync 抖动牵连，
 * 也不会在繁忙磁盘上把 199 次原子写拖过 vitest 的默认 5s 超时。持久化语义
 * 由跑真实 JSON 栈的用例覆盖（service.spec、本文件的建树/级联/重启用例）。
 * For cases that test service semantics rather than durability (batch tree
 * building for the safety limits): the real hub and domain layer keep running,
 * only the medium becomes memory — case duration no longer tracks disk fsync
 * jitter, and 199 atomic writes cannot drag past vitest's default 5s timeout
 * on a busy disk. Durability semantics stay covered by the cases that run the
 * real JSON stack (service.spec, plus this file's tree/cascade/restart cases).
 *
 * 与 json 后端插件同构：注册进 hub 的 backend 表，并按同一条约定 provide
 * 生命周期键，domain 层照常 `{ backend: 'memory' }` 路由。全类型化，零 cast。
 * Isomorphic to the json backend plugin: registered in the hub's backend table
 * and provided under the same lifecycle-key convention, so the domain layer
 * routes with `{ backend: 'memory' }` as usual. Fully typed, zero casts.
 */
import { StorageError, storageBackendServiceKey } from '@deepseek-ai/dsh-storage'
import type { Context } from '@deepseek-ai/cordis'
import type { KvFacet, KvUnit, KvUnitDescriptor, StorageBackend } from '@deepseek-ai/dsh-storage'

/** 一张内存表：Map 即介质 / one in-memory table: the Map is the medium */
class MemoryKvUnit implements KvUnit {
  readonly #tables = new Map<string, Map<string, unknown>>()
  readonly #hasGlobal: boolean
  #global: unknown = null
  #closed = false

  constructor(descriptor: KvUnitDescriptor, private readonly onClosed: () => void) {
    this.#hasGlobal = descriptor.hasGlobal
    for (const table of descriptor.tables) this.#tables.set(table, new Map())
  }

  async loadAll(): Promise<{ tables: Record<string, Record<string, unknown>>; global: unknown }> {
    this.#assertOpen()
    const tables: Record<string, Record<string, unknown>> = {}
    for (const [table, records] of this.#tables) tables[table] = Object.fromEntries(records)
    return { tables, global: this.#global }
  }

  async putRecord(table: string, key: string, value: unknown): Promise<void> {
    this.#assertOpen()
    this.#table(table).set(key, value)
  }

  async deleteRecord(table: string, key: string): Promise<void> {
    this.#assertOpen()
    this.#table(table).delete(key)
  }

  async setGlobal(value: unknown): Promise<void> {
    this.#assertOpen()
    if (!this.#hasGlobal) throw new StorageError('malformed-medium', 'memory unit declares no global slot')
    this.#global = value
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    this.onClosed()
  }

  #assertOpen(): void {
    if (this.#closed) throw new StorageError('closed', 'memory unit is closed')
  }

  #table(table: string): Map<string, unknown> {
    const records = this.#tables.get(table)
    if (records === undefined) throw new Error(`memory unit does not declare table '${table}'`)
    return records
  }
}

/** 内存后端：kv facet 的 Map 实现，同名 unit 单开 / the memory backend: a Map kv facet, one live handle per unit name */
export class MemoryStorageBackend implements StorageBackend {
  readonly #open = new Map<string, MemoryKvUnit>()
  #closed = false

  readonly kv: KvFacet = {
    open: async (descriptor: KvUnitDescriptor): Promise<KvUnit> => {
      if (this.#closed) throw new StorageError('closed', 'memory backend is closed')
      if (this.#open.has(descriptor.name)) {
        throw new Error(`unit '${descriptor.name}' is already open; a unit has exactly one live handle`)
      }
      const unit = new MemoryKvUnit(descriptor, () => this.#open.delete(descriptor.name))
      this.#open.set(descriptor.name, unit)
      return unit
    },
  }

  async close(): Promise<void> {
    this.#closed = true
    for (const unit of [...this.#open.values()]) await unit.close()
  }
}

/**
 * 把内存后端挂上 ctx（注册表条目 + 生命周期键，与 json 插件的 apply 同构），
 * 卸载时逆序收线：先注销、再释放介质。
 * Mount the memory backend on ctx (registry entry plus lifecycle key,
 * isomorphic to the json plugin's apply); teardown runs in reverse:
 * unregister first, then release the medium.
 */
export function mountMemoryBackend(ctx: Context, backend: MemoryStorageBackend): void {
  ctx.effect(() => {
    const unregister = ctx.storage.backend.register('memory', backend)
    ctx.provide(storageBackendServiceKey('memory'), backend)
    return async () => {
      unregister()
      await backend.close()
    }
  }, 'task-center-tests:memory-backend')
}
