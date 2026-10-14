/**
 * The DeviceId service: the immutable resolved id plus the resolution policy.
 * DeviceId 服务：不可变的已解析 ID 与解析策略。
 *
 * Resolution order (each tier backs the previous one's loss):
 * 解析顺序（每级兜底上一级的丢失）：
 *   1. dsh domain store (the durable, schema-validated anchor)
 *      dsh domain 存储（持久、过 schema 校验的第一锚点）
 *   2. platform out-of-band anchor (e.g. Windows registry)
 *      平台带外锚点（如 Windows 注册表）
 *   3. stable-tier hardware fingerprint, deterministically mapped to a UUID
 *      稳定级硬件指纹确定性映射（跨重装尽力而为）
 *   4. fresh random UUID
 *      新随机 UUID
 */

import { randomUUID } from 'node:crypto';
import { Service } from '@deepseek-ai/cordis';
import { hashToUuid } from './hash.js';
import { DeviceIdToken } from './protocol.js';
import type { DeviceId, DeviceIdPlatform, DeviceIdRecord, DeviceIdSource } from './protocol.js';
import type { DomainGlobal } from '@deepseek-ai/dsh-storage-domain';
import type { Context } from '@deepseek-ai/cordis';

/** Max historical fingerprints kept on the record. 记录保留的历史指纹上限。 */
const MAX_FINGERPRINTS = 8;

/** 输入：domain global 当前值与平台能力。 Inputs: the domain global value + the platform. */
export interface DeviceIdResolverInput {
  readonly stored: DeviceIdRecord;
  readonly platform: DeviceIdPlatform;
  readonly now: number;
}

/** 纯解析：返回 id、来源与待写回记录。 Pure resolution: id, source, record to write back. */
export function resolveDeviceId(input: DeviceIdResolverInput): {
  id: string;
  source: DeviceIdSource;
  record: DeviceIdRecord;
} {
  const { stored, platform, now } = input;
  const fp = platform.stableFingerprint();

  // 1) domain 存储命中：第一锚点（不重装系统必稳定）
  if (stored.id !== '') {
    const fingerprints = fp && !stored.fingerprints.includes(fp)
      ? [...stored.fingerprints, fp].slice(-MAX_FINGERPRINTS)
      : stored.fingerprints;
    return { id: stored.id, source: 'domain-store', record: { ...stored, fingerprints, updatedAt: now } };
  }

  // 2) 平台带外锚点（如注册表镜像）
  const anchored = platform.recoverAnchoredId();
  if (anchored) return { id: anchored, source: 'platform-anchor', record: newRecord(anchored, fp, now) };

  // 3) 稳定级硬件指纹派生（跨重装尽力而为）
  if (fp) {
    const derived = hashToUuid(fp);
    return { id: derived, source: 'fingerprint', record: newRecord(derived, fp, now) };
  }

  // 4) 全部未命中：新随机 ID
  const fresh = randomUUID();
  return { id: fresh, source: 'fresh', record: newRecord(fresh, fp, now) };
}

/** 组装新记录。 A fresh record. */
function newRecord(id: string, fp: string | null, now: number): DeviceIdRecord {
  return { id, fingerprints: fp ? [fp] : [], createdAt: now, updatedAt: now };
}

/** The service: constructed only after resolution, so `id` is always valid. 服务：解析完成后才构造，`id` 恒有效。 */
export class DeviceIdService extends Service implements DeviceId {
  constructor(
    ctx: Context,
    private readonly resolvedId: string,
    private readonly resolvedSource: DeviceIdSource,
    private readonly globalStore: DomainGlobal<DeviceIdRecord>,
    private readonly platform: DeviceIdPlatform,
  ) {
    super(ctx, DeviceIdToken);
  }

  get id(): string {
    return this.resolvedId;
  }

  get source(): DeviceIdSource {
    return this.resolvedSource;
  }

  /** Durable write-back + platform anchor; never throws. 持久写回 + 平台锚点；不抛出。 */
  async persist(record: DeviceIdRecord): Promise<void> {
    try {
      await this.globalStore.set(record);
    } catch {
      // 写回失败不中断服务（指纹级兜底仍可用）
      // a failed write-back never breaks the service; the fingerprint tier still holds
    }
    this.platform.anchor(this.resolvedId);
  }
}
