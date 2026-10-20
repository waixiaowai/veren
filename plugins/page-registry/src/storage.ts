/**
 * `app_pages` 存储域：页面实例索引的持久化介质。
 * The `app_pages` storage domain: the durable medium for the instance index.
 *
 * 与 notebook/forum 同一路子：`defineDomain` 声明一次，`ctx.storageDomain.open()`
 * 打开，落 `$DSH_HOME/storages`，重启后原样读回。行不合 schema 时整个域打开失败
 * （misconfiguration fails loud），不悄悄丢行。
 *
 * @module @veren/page-registry/storage
 */
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { InstanceKvPort } from '@veren/prompt-page'
import type { PageInstanceRecord } from '@veren/prompt-page'

const instanceSchema = z.object({
  url: z.string().min(1),
  // reserved：两阶段创建中；live：URL 当前的活会话；deprecated：被重开取代的历史行
  // reserved: mid two-phase create; live: the url's current session; deprecated: superseded history
  state: z.enum(['reserved', 'live', 'deprecated']),
  appId: z.string().min(1),
  page: z.string().min(1),
  sessionId: z.string().min(1),
  instanceTitle: z.string().min(1),
  pageRevision: z.number().int().min(1),
  params: z.record(z.string(), z.string()),
  appVersion: z.string().min(1),
  createdAt: z.string().min(1),
  lastOpenedAt: z.string().min(1),
  deprecatedAt: z.string().min(1).optional(),
})

/**
 * 权威索引存储：只有一张 `instances` 表，键是规范 URL（§3.5.2）。
 * The authoritative index storage: one `instances` table keyed by canonical url.
 */
export const appPagesDomain = defineDomain({
  name: 'app_pages',
  version: 1,
  tables: {
    instances: domainTable<string, PageInstanceRecord>(instanceSchema as never), // brand 字段（url）由 zod 侧表现为 string，运行时同形
  },
})

/** 存储域名字（诊断用）/ domain name, shared with diagnostics */
export const APP_PAGES_DOMAIN_NAME = appPagesDomain.name

/**
 * 把域表投影成索引需要的最小 KV 端口。
 * Project a domain table onto the minimal kv port the index consumes.
 */
export function instanceTableView(table: KvTable<string, PageInstanceRecord>): InstanceKvPort {
  return {
    get: (key) => table.get(key),
    put: (key, value) => table.put(key, value),
    del: (key) => table.delete(key),
    all: () => [...table.entries()].map(([, value]) => value),
  }
}
