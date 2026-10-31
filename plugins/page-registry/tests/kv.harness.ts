/**
 * 内存 KV 假件（与 app-pages 域表同形）：runtime/delivery 两组夹具共用的唯一一份。
 * The in-memory kv fake (same shape as the app_pages domain table): the single
 * copy shared by the runtime and delivery fixture sets.
 *
 * @module @veren/page-registry/tests/kv.harness
 */
import type { InstanceKvPort, PageInstanceRecord } from '@veren/prompt-page'

/** 内存 KV（与 app-pages 域表同形），可跨"重启"复用 / in-memory kv, reusable across "restarts" */
export function memKv(): InstanceKvPort & { readonly map: Map<string, PageInstanceRecord> } {
  const map = new Map<string, PageInstanceRecord>()
  return {
    map,
    get: (key) => map.get(key),
    put: async (key, value) => { map.set(key, value) },
    del: async (key) => map.delete(key),
    all: () => [...map.values()],
  }
}
