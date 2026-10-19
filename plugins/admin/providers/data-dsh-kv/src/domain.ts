/**
 * The `admin_data` storage domain: one table, one document per capability
 * record, declared once with `defineDomain` and opened through
 * `ctx.storageDomain.open()`.
 *
 * The medium (`json` or `sqlite`) is decided by the storage group's
 * backend/routes configuration, never here. Every capability's records evolve
 * independently, so the durable schema only guarantees `id`; a hand-edited or
 * truncated document without one still fails the domain open loudly.
 *
 * `admin_data` 存储域：单表，每条能力记录一个文档，用 `defineDomain` 声明一次，
 * 经 `ctx.storageDomain.open()` 打开。介质（`json` 或 `sqlite`）由 storage group 的
 * backend/routes 配置决定，与本模块无关。各能力的记录独立演进，因此持久化 schema 只
 * 保证 `id`；缺失 `id` 的手工编辑或截断文档仍会让 domain 打开显式失败。
 *
 * @module @veren/admin-data-dsh-kv/domain
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'

/** Domain name; `UNIT_NAME_RE` admits letters, digits and underscores only. domain 名；`UNIT_NAME_RE` 只接受字母、数字与下划线。 */
export const ADMIN_DATA_DOMAIN_NAME = 'admin_data'

/** Domain format version. Bump only with a migration promise. domain 格式版本；仅在承诺迁移时提升。 */
export const ADMIN_DATA_DOMAIN_VERSION = 1

/** The single table holding every capability record. 存放全部能力记录的唯一表。 */
export const RECORDS_TABLE = 'records'

/** Literal name of the records table, for the structural KV handle. records 表的字面量名，供结构化 KV 句柄使用。 */
export type RecordsTableName = typeof RECORDS_TABLE

/**
 * Loose record schema: only the identity is durable contract, because each
 * capability owns and evolves the rest of its fields between releases.
 *
 * 宽松记录 schema：只有身份属于持久契约，其余字段由各能力拥有并随版本演进。
 */
const adminDataRecord = z.looseObject({ id: z.string() })

/**
 * The declared domain. `per-record` layout: records are small, independent and
 * individually replaceable, so one document each keeps writes local and lets a
 * single corrupt record be isolated instead of poisoning the whole unit.
 *
 * 声明的 domain。`per-record` 布局：记录小、彼此独立且可单独替换，因此一条记录一个
 * 文档既让写入保持局部，也能隔离单条损坏记录而不污染整个单元。
 */
export const adminDataDomain = defineDomain({
  name: ADMIN_DATA_DOMAIN_NAME,
  version: ADMIN_DATA_DOMAIN_VERSION,
  layout: 'per-record',
  tables: { [RECORDS_TABLE]: domainTable(adminDataRecord) },
})

/** Stored record value as the domain spec validates it. domain 声明所校验的存储记录值。 */
export type AdminDataRecord = z.infer<typeof adminDataRecord>

/** The opened handle type of {@link adminDataDomain}. {@link adminDataDomain} 打开后的句柄类型。 */
export type AdminDataDomain = Domain<typeof adminDataDomain>
