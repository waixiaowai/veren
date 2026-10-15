/**
 * In-memory `KvTable`/domain stub mirroring the durable contract: reads come
 * from memory, writes land through a single async chain, and a closed domain
 * rejects new writes. Good enough to exercise the adapter and Better Auth
 * flows without a storage backend.
 * 内存 `KvTable`/domain 桩，镜像持久契约：读来自内存，写经单一异步链，关闭后
 * 拒绝新写入。足以在没有存储后端的情况下演练适配器与 Better Auth 流程。
 * @module tests/memory-domain
 */

import { LOGIN_GATE_MODELS } from '../src/domain.js'
import type { LoginGateDomain, LoginGateModel } from '../src/domain.js'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'

/** One auth record. 一条认证记录。 */
type AuthRecord = Record<string, unknown>

/** In-memory table honoring the KvTable shape. 满足 KvTable 形状的内存表。 */
class MemoryTable implements KvTable<string, AuthRecord> {
  private readonly rows = new Map<string, AuthRecord>()

  get(key: string): AuthRecord | undefined {
    return this.rows.get(key)
  }

  entries(): IterableIterator<[string, AuthRecord]> {
    return [...this.rows.entries()][Symbol.iterator]()
  }

  keys(): IterableIterator<string> {
    return this.rows.keys()
  }

  get size(): number {
    return this.rows.size
  }

  async put(key: string, value: AuthRecord): Promise<void> {
    await Promise.resolve()
    this.rows.set(key, value)
  }

  async delete(key: string): Promise<boolean> {
    await Promise.resolve()
    return this.rows.delete(key)
  }

  async update(key: string, fn: (current: AuthRecord) => AuthRecord): Promise<AuthRecord> {
    const current = this.rows.get(key)
    if (current === undefined) throw new Error(`missing key ${key}`)
    const next = fn(current)
    this.rows.set(key, next)
    return next
  }
}

/**
 * Build a fresh in-memory login-gate domain.
 * @returns the domain-shaped stub.
 */
export function memoryLoginGateDomain(): LoginGateDomain {
  const tables = new Map<LoginGateModel, MemoryTable>(
    LOGIN_GATE_MODELS.map(model => [model, new MemoryTable()]),
  )
  return {
    name: 'web-login-gate',
    global: undefined as never,
    table: (name: string) => tables.get(name as LoginGateModel) as KvTable<never, never>,
    close: async () => {},
  } as unknown as LoginGateDomain
}
