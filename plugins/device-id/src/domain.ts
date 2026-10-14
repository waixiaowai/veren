/**
 * The device-id dsh storage domain: one global record slot.
 * 设备 ID 的 dsh storage domain：单一 global 记录槽。
 */

import { z } from 'zod';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import type { DomainSpec } from '@deepseek-ai/dsh-storage-domain';

/** Zod schema of DeviceIdRecord (kept in sync with src/protocol.ts). 记录的 zod schema（与 protocol.ts 保持一致）。 */
export const deviceIdRecordSchema = z.object({
  id: z.string(),
  fingerprints: z.array(z.string()),
  createdAt: z.number(),
  updatedAt: z.number(),
});

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
}) as DomainSpec;
