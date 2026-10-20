/**
 * In-memory stand-in for the storage-domain handle.
 *
 * The adapter only touches the structural subset declared in `../src/adapter.ts`,
 * so this double keeps the whole package testable without a DSH runtime. It
 * stores records in a `Map`, mimics the real handle's snapshot key iteration,
 * and can be switched into a failing state to exercise the health probe.
 *
 * 存储域句柄的内存替身。适配器只触碰 `../src/adapter.ts` 声明的结构子集，因此该
 * 替身让整个包无需 DSH 运行时即可测试。它用 `Map` 保存记录，模拟真实句柄的快照键
 * 迭代，并可切换到失败状态以检验健康探测。
 *
 * @module @veren/admin-data-dsh-kv/tests/fake-domain
 */

import type { AdminEntity } from '@veren/admin-contract'
import type { KvDomainHandle, KvTableHandle } from '../src/adapter.ts'
import type { RecordsTableName } from '../src/domain.ts'

/** One fake domain: a record map plus a switchable failure. 单个假 domain：记录表加可切换的失败状态。 */
export class FakeDomain implements KvDomainHandle {
  /** Stored records, keyed by the adapter's path-safe composite key. 存储记录，键为适配器的 path-safe 复合键。 */
  readonly records = new Map<string, AdminEntity>()

  /** How many times `close()` ran; the plugin must close the domain on dispose. `close()` 的调用次数；插件必须在卸载时关闭 domain。 */
  closes = 0

  /** Failure message used by every handle access, when set. 设置后句柄每次访问抛出的消息。 */
  private failure: string | undefined

  /**
   * Resolve the records table handle over this map.
   * @param _name - the only declared table name 唯一声明的表名
   * @returns the table handle 表句柄
   */
  table(_name: RecordsTableName): KvTableHandle {
    const domain = this
    return {
      get(key: string): AdminEntity | undefined {
        domain.assertUsable()
        return domain.records.get(key)
      },
      async put(key: string, value: AdminEntity): Promise<void> {
        domain.assertUsable()
        domain.records.set(key, value)
      },
      async delete(key: string): Promise<boolean> {
        domain.assertUsable()
        return domain.records.delete(key)
      },
      keys(): IterableIterator<string> {
        domain.assertUsable()
        return [...domain.records.keys()][Symbol.iterator]()
      },
      get size(): number {
        domain.assertUsable()
        return domain.records.size
      },
    }
  }

  /**
   * Make every subsequent handle access throw, like a closed medium.
   * @param message - failure message 失败消息
   */
  break(message = 'fake domain handle is closed'): void {
    this.failure = message
  }

  /**
   * Close the domain the way the real facility does. 像真实设施那样关闭 domain。
   * @returns resolution after closing 关闭后的 resolve
   */
  async close(): Promise<void> {
    this.closes += 1
  }

  /** Throw when the fake is broken. 假替身损坏时抛出。 */
  private assertUsable(): void {
    if (this.failure !== undefined) throw new Error(this.failure)
  }
}
