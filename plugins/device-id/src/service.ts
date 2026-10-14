/**
 * The DeviceId service: resolves the stable id once via the fallback chain
 * store file -> registry mirror -> hardware fingerprint -> fresh random.
 * DeviceId 服务：按 存储文件 -> 注册表镜像 -> 硬件指纹 -> 新随机 的链路解析一次。
 */

import { createHash, randomUUID } from 'node:crypto';
import type { Context } from '@deepseek-ai/cordis';
import { Service } from '@deepseek-ai/cordis';
import { computeFingerprint } from './fingerprint.js';
import { DeviceIdToken } from './protocol.js';
import type { DeviceId, DeviceIdRecord, DeviceIdSource } from './protocol.js';
import { readRegistryId, readStoreFile, writeRegistryId, writeStoreFile } from './store.js';

/** 归一化的服务配置 / the normalized service config */
export interface DeviceIdOptions {
  /** 存储文件路径 / the anchored store-file path */
  storeFile: string;
}

/** 兜底的 ID 形状：随机 UUID。 The fallback id shape: a random UUID. */
function mintId(): string {
  return randomUUID();
}

/** 将硬件指纹哈希确定性地映射为 UUID v5 形状。 Map a fingerprint hash into a UUID-v5-shaped id. */
export function hashToUuid(hex: string): string {
  const h = createHash('sha256').update('veren-device-id:' + hex, 'utf8').digest('hex').slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export class DeviceIdService extends Service implements DeviceId {
  private cached: string | null = null;
  private resolvedSource: DeviceIdSource = 'fresh';

  constructor(
    ctx: Context,
    private readonly options: DeviceIdOptions,
  ) {
    super(ctx, DeviceIdToken);
  }

  /** 最近一次解析来源。 The latest resolution source. */
  get source(): DeviceIdSource {
    return this.cached !== null ? this.resolvedSource : 'fresh';
  }

  /** 取设备 ID：懒解析 + 进程内缓存。 Lazily resolve then cache for the process lifetime. */
  getId(): string {
    if (this.cached !== null) return this.cached;
    const [id, source, record] = this.resolve();
    this.cached = id;
    this.resolvedSource = source;
    this.persist(record, id);
    return id;
  }

  /** 采集当前硬件指纹（无则 null）。 The current hardware fingerprint, or null. */
  currentFingerprint(): string | null {
    return computeFingerprint();
  }

  /** 回退链解析；返回 id、来源与待持久化记录。 The fallback chain: returns id, source, record-to-persist. */
  private resolve(): readonly [string, DeviceIdSource, DeviceIdRecord] {
    const now = Date.now();
    const fp = computeFingerprint();

    // 1) 存储文件：第一锚点（不重装系统务必稳定）/ the primary anchor
    const fileRecord = readStoreFile(this.options.storeFile);
    if (fileRecord) {
      const merged: DeviceIdRecord = {
        ...fileRecord,
        fingerprints: fp && !fileRecord.fingerprints.includes(fp) ? [...fileRecord.fingerprints, fp].slice(-8) : fileRecord.fingerprints,
        updatedAt: now,
      };
      return [fileRecord.id, 'store-file', merged];
    }

    // 2) 注册表镜像 / the registry mirror
    const regId = readRegistryId();
    if (regId) {
      return [regId, 'registry', this.newRecord(regId, fp, now)];
    }

    // 3) 硬件指纹派生：同硬件重装系统后仍可得到同一 ID（尽力而为）。
    //    Deterministic from the hardware fingerprint: an OS reinstall on the
    //    same hardware yields the same id (best-effort).
    if (fp) {
      const derived = hashToUuid(fp);
      return [derived, 'fingerprint', this.newRecord(derived, fp, now)];
    }

    // 4) 全部未命中：新随机 ID / nothing hit: mint a fresh random id
    const fresh = mintId();
    return [fresh, 'fresh', this.newRecord(fresh, fp, now)];
  }

  /** 组装新记录（携带当前指纹）。 A new record carrying the current fingerprint. */
  private newRecord(id: string, fp: string | null, now: number): DeviceIdRecord {
    return { id, fingerprints: fp ? [fp] : [], createdAt: now, updatedAt: now };
  }

  /** 持久化：文件 + 注册表镜像，全部尽力而为。 Persist to file + registry mirror, best-effort. */
  private persist(record: DeviceIdRecord, id: string): void {
    try {
      writeStoreFile(this.options.storeFile, record);
    } catch {
      // 文件不可写时不中断服务 / an unwritable store file never breaks the service
    }
    writeRegistryId(id);
  }
}


