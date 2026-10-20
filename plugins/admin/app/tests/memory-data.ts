/**
 * In-memory `data` provider shared by the admin composition tests.
 *
 * It mirrors the KV adapter's read model closely enough for auth, access, nav
 * and audit, so a composition can boot without a storage backend.
 *
 * 后台组合测试共享的内存 `data` provider。其读模型与 KV 适配器足够接近，使 auth、
 * access、nav 与 audit 无需存储后端即可启动。
 */

import type { AdminEntity, AdminTable, ProviderManifest } from '@veren/admin-contract'

/** Manifest the in-memory provider registers. 内存 provider 注册的清单。 */
export function dataManifest(): ProviderManifest {
  return { id: 'memory-data', capability: 'data', contract: '^1.0', priority: 0, label: 'memory' }
}

/** In-memory database whose tables live for one composition. 表随一次组合存续的内存数据库。 */
export function memoryDatabase() {
  const tables = new Map<string, Map<string, AdminEntity>>()
  const table = <T extends AdminEntity>(name: string): AdminTable<T> => {
    const rows = tables.get(name) ?? new Map<string, AdminEntity>()
    tables.set(name, rows)
    return {
      find: (id: string) => rows.get(id) as T | undefined,
      list: () => [...rows.values()] as T[],
      save: async (record: T) => {
        rows.set(record.id, record)
      },
      remove: async (id: string) => rows.delete(id),
      size: rows.size,
    }
  }
  return {
    features: { transactions: false, secondaryIndexes: false, fullText: false },
    table,
    transaction: async (work: (uow: { table: typeof table }) => Promise<unknown>) => work({ table }),
    health: async () => ({ status: 'ok' as const }),
  }
}
