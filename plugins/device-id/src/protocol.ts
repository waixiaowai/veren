/**
 * @veren/device-id - the platform-agnostic device identity contracts.
 * @veren/device-id - 平台无关的设备身份契约。
 *
 * The core plugin owns the resolution policy; each OS ships its own platform
 * plugin (@veren/device-id-win/-mac/-linux) that supplies fingerprints and
 * out-of-band anchors.
 * 核心插件只负责解析策略；各操作系统由对应平台插件提供指纹与带外锚点。
 */

import { defineToken } from '@veren/core';

/** The stable device-id service facade. 稳定设备 ID 服务门面。 */
export abstract class DeviceId {
  /** The stable device id, valid for the service lifetime. 稳定设备 ID，服务存活期内不变。 */
  abstract get id(): string;
  /** How the id was resolved (for diagnostics). ID 的解析来源（诊断用）。 */
  abstract get source(): DeviceIdSource;
}

/** The service token of the core service. 核心服务的服务令牌。 */
export const DeviceIdToken = defineToken<DeviceId>('device-id');

/** One OS-specific platform plugin. 平台插件提供的平台能力。 */
export interface DeviceIdPlatform {
  /**
   * Current stable-tier hardware fingerprint (normalized hex), or null when
   * nothing could be collected. 当前稳定级硬件指纹；采集不到为 null。
   */
  stableFingerprint(): string | null;
  /**
   * Recover a previously anchored id from OS-specific out-of-band storage
   * (e.g. the Windows registry), or null. 从平台带外存储回收历史 ID；无则 null。
   */
  recoverAnchoredId(): string | null;
  /**
   * Best-effort anchor the id into OS-specific out-of-band storage.
   * 尽力而为地把 ID 写入平台带外存储。
   */
  anchor(id: string): void;
}

/** The service token platform plugins provide. 平台插件提供的服务令牌。 */
export const DeviceIdPlatformToken = defineToken<DeviceIdPlatform>('device-id-platform');

/** Where the current id came from. 当前 ID 的解析来源。 */
export type DeviceIdSource =
  /** The dsh domain store hit. dsh domain 存储命中。 */
  | 'domain-store'
  /** The platform anchor hit (e.g. registry). 平台锚点命中（如注册表）。 */
  | 'platform-anchor'
  /** The hardware fingerprint derived the id. 硬件指纹派生。 */
  | 'fingerprint'
  /** Nothing hit; a fresh random id was minted. 全部未命中，新生成随机 ID。 */
  | 'fresh';

/** The durable domain-store record. domain 存储的持久化记录。 */
export interface DeviceIdRecord {
  /** The device id ('' = never written). 设备 ID（'' = 从未写入）。 */
  id: string;
  /** Historical hardware fingerprints (capped roll). 历史硬件指纹（滚动截断）。 */
  fingerprints: string[];
  /** Epoch ms of first creation. 首次创建时间。 */
  createdAt: number;
  /** Epoch ms of the latest write. 最近一次更新时间。 */
  updatedAt: number;
}
