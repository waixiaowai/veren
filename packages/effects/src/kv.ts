/**
 * Adapter binding the effects core to a key/value table — the runtime backend.
 *
 * The bound surface {@link EffectKvTable} is a structural subset of
 * `KvTable<string, EffectRow>` from `@deepseek-ai/dsh-storage-domain`, the
 * host storage API the task-center and im plugins actually persist through
 * (both declare their domains with `defineDomain` and open them via
 * `ctx.storageDomain.open`). This package therefore imports no DSH code: a
 * caller passes `domain.table('effects')` and the structural match does the
 * binding, typechecked against the real DSH interface in the adapter tests.
 *
 * Row writes go through the domain's own per-domain write chain and the core
 * serializes its mutations internally, so the adapter stays a thin mapping.
 *
 * 把效果核绑到键值表上的适配器——运行时后端。被绑面 {@link EffectKvTable} 是
 * `@deepseek-ai/dsh-storage-domain` 的 `KvTable<string, EffectRow>` 的结构子集，
 * 也就是 task-center 与 im 插件实际持久化所用的宿主存储 API（两者都用 `defineDomain`
 * 声明域、经 `ctx.storageDomain.open` 打开）。因此本包不 import 任何 DSH 代码：
 * 调用方传入 `domain.table('effects')`，结构匹配即完成绑定，适配器测试里对着真实
 * DSH 接口做类型校验。行的写入走域自身的按域写链，核又在内部串行自己的变更，
 * 适配器只是一层薄映射。
 *
 * @module @veren/effects/kv
 */

import type { EffectRow, EffectStorage } from './rows.ts'
import { effectRowKey } from './rows.ts'

/**
 * The table surface the adapter needs; `KvTable<string, EffectRow>` of
 * `@deepseek-ai/dsh-storage-domain` satisfies it verbatim.
 * / 适配器需要的表面；`@deepseek-ai/dsh-storage-domain` 的 `KvTable<string, EffectRow>`
 * 原样满足它。
 */
export interface EffectKvTable {
  get(key: string): EffectRow | undefined
  entries(): IterableIterator<[string, EffectRow]>
  put(key: string, value: EffectRow): Promise<void>
  delete(key: string): Promise<boolean>
}

/**
 * Bind one key/value table as the effects medium; rows are keyed by the
 * composite {@link effectRowKey} (kind, NUL separator, key) so kinds and
 * keys stay isolated.
 * / 把一张键值表绑成效果介质；行键为 {@link effectRowKey} 的复合键
 * （kind + NUL 分隔符 + key），kind 与 key 互不串扰。
 */
export function kvEffectStorage(table: EffectKvTable): EffectStorage {
  return {
    load: async () => [...table.entries()].map(([, row]) => row),
    list: kind => [...table.entries()].map(([, row]) => row).filter(row => kind === undefined || row.kind === kind),
    put: async row => {
      await table.put(effectRowKey(row.kind, row.key), row)
    },
    delete: async (kind, key) => table.delete(effectRowKey(kind, key)),
  }
}
