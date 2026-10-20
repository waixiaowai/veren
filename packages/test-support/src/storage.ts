/**
 * 临时存储域：每个测试一份临时目录 + 真实 storage 栈（json backend）。
 * Temporary storage domains: one temp directory per test plus the real
 * storage stack (json backend).
 *
 * 目录建在系统临时目录下，绝不落在仓库里；`TempDirs.disposeAll()` 与创建
 * 严格成对，测试结束（或宿主 `dispose()`）时全部删净。
 * Roots live under the OS temp dir, never inside the repository;
 * `TempDirs.disposeAll()` is the strict counterpart of creation and removes
 * every root when the test (or the host `dispose()`) ends.
 *
 * @module @veren/test-support/storage
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context, Fiber } from '@deepseek-ai/cordis'
import * as Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'

/** 临时目录的登记与清理，创建/删除严格成对。Tracks temp roots; creation and removal stay paired. */
export class TempDirs {
  readonly #roots: string[] = []

  /** 建一份带标签前缀的临时目录并登记。Create a labelled temp root and track it. */
  create(label: string): string {
    const root = mkdtempSync(join(tmpdir(), `veren-test-${label}-`))
    this.#roots.push(root)
    return root
  }

  /** 逆序删除全部登记的目录；之后实例可以继续复用。Remove all tracked roots newest-first; the tracker stays reusable. */
  disposeAll(): void {
    for (const root of this.#roots.splice(0).reverse()) {
      rmSync(root, { recursive: true, force: true })
    }
  }
}

/** 一次 storage 栈挂载：临时根目录 + 与之成对的卸载器。One storage mount: a temp root plus its paired disposer. */
export interface StorageMount {
  /** 本挂载使用的临时目录（仅诊断用；清理走 dispose）。The temp root in use (diagnostics only; cleanup goes through dispose). */
  readonly root: string
  /** 逆序卸载 storage 栈的三个插件 fiber。Dispose the three storage plugin fibers newest-first. */
  dispose(): Promise<void>
}

/**
 * 在 ctx 上挂真实 storage 栈（storage → json backend → domain），目录来自
 * 给定的 TempDirs，由调用方统一清理。
 * Mount the real storage stack (storage → json backend → domain) on `ctx`,
 * taking the directory from the given TempDirs so the caller cleans up once.
 */
export async function mountStorage(ctx: Context, dirs: TempDirs): Promise<StorageMount> {
  const root = dirs.create('storage')
  const storageFiber: Fiber = await ctx.plugin(Storage.default)
  const jsonFiber: Fiber = await ctx.plugin(StorageJson, { root })
  const domainFiber: Fiber = await ctx.plugin(StorageDomain, { backend: 'json' })
  return {
    root,
    // 与挂载逆序：domain → json → storage / reverse of the mount order
    dispose: async () => {
      for (const fiber of [domainFiber, jsonFiber, storageFiber]) {
        await fiber.dispose().catch(() => undefined)
      }
    },
  }
}
