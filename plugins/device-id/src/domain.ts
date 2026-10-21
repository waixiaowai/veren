/**
 * The device-id dsh storage domain: one global record slot.
 * 设备 ID 的 dsh storage domain：单一 global 记录槽。
 */

import { z } from 'zod';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import type { DeviceIdRecord } from './protocol.js';

/**
 * Zod schema of {@link DeviceIdRecord}. The `satisfies` pin makes the schema
 * fail the build the moment the interface in protocol.ts drifts from it, so the
 * two declarations can never silently disagree.
 * {@link DeviceIdRecord} 的 zod schema。`satisfies` 在此钉住输出类型：protocol.ts
 * 的接口一旦与 schema 不一致就编译失败，两处声明不可能悄悄跑偏。
 */
export const deviceIdRecordSchema = z.object({
  id: z.string(),
  fingerprints: z.array(z.string()),
  createdAt: z.number(),
  updatedAt: z.number(),
}) satisfies z.ZodType<DeviceIdRecord>;

/** The 'never written' initial global (empty id). 「从未写入」的初始 global（空 ID）。 */
export const EMPTY_RECORD: z.infer<typeof deviceIdRecordSchema> = {
  id: '',
  fingerprints: [],
  createdAt: 0,
  updatedAt: 0,
};

/**
 * Domain name must match UNIT_NAME_RE (`/^[a-z][a-z0-9_]*$/`), hence the
 * underscore. 域名须匹配 UNIT_NAME_RE（不允许连字符），故用下划线。
 *
 * No `as DomainSpec` cast: keeping the inferred literal spec is what lets
 * `ctx.storageDomain.open()` derive `global` as `DomainGlobal<DeviceIdRecord>`.
 * 不做 `as DomainSpec` 断言：保留推导出的字面量 spec，`ctx.storageDomain.open()`
 * 才能把 `global` 推导成 `DomainGlobal<DeviceIdRecord>`。
 */
export const deviceIdDomain = defineDomain({
  name: 'device_id',
  version: 1,
  tables: {
    // 占位表：本域只用 global 槽；domain 规范要求 tables 至少可解析。
    // placeholder: this domain only uses the global slot today.
    meta: domainTable(deviceIdRecordSchema),
  },
  global: {
    schema: deviceIdRecordSchema,
    initial: EMPTY_RECORD,
  },
});
