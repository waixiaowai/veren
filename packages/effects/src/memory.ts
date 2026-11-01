/**
 * In-memory backend of the effects core (test and domain-test medium).
 *
 * The Map is the medium: an instance survives its `Effects` instance, which
 * is exactly what the kill-and-restart (death) tests need — a new
 * `Effects.open` over the same storage resumes the rows the killed process
 * left behind. Production media bind through `kvEffectStorage` instead.
 *
 * 效果核的内存后端（测试与领域测试介质）。Map 即介质：实例活得比 `Effects` 久，
 * 这正是"杀死进程后重启"死刑测试需要的——对同一 storage 重新 `Effects.open`，
 * 就能接手被杀进程留下的行。生产介质改走 `kvEffectStorage` 绑定。
 *
 * @module @veren/effects/memory
 */

import type { EffectRow, EffectStorage } from './rows.ts'
import { effectRowKey } from './rows.ts'

/** 一个 Map 即介质的效果存储 / one effect storage whose medium is a Map */
export class MemoryEffectStorage implements EffectStorage {
  readonly #rows = new Map<string, EffectRow>()

  async load(): Promise<readonly EffectRow[]> {
    return [...this.#rows.values()]
  }

  list(kind?: string): readonly EffectRow[] {
    return [...this.#rows.values()].filter(row => kind === undefined || row.kind === kind)
  }

  async put(row: EffectRow): Promise<void> {
    this.#rows.set(effectRowKey(row.kind, row.key), row)
  }

  async delete(kind: string, key: string): Promise<boolean> {
    return this.#rows.delete(effectRowKey(kind, key))
  }
}
