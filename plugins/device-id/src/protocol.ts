/**
 * @veren/device-id - the stable device identity: the service token and the
 * type contracts.
 * @veren/device-id - 稳定设备标识：服务令牌与类型契约。
 */

import { defineToken } from '@veren/core';

/** The stable device-id service facade. 稳定设备 ID 服务门面。 */
export abstract class DeviceId {
  /** Returns the device id, cached per process. 取设备 ID：进程内缓存，同机稳定。 */
  abstract getId(): string;
  /** How the id was resolved most recently (for diagnostics). 最近一次解析来源（诊断用）。 */
  abstract get source(): DeviceIdSource;
}

/** The service token; the name doubles as the label. 服务令牌：名字兼作标签。 */
export const DeviceIdToken = defineToken<DeviceId>('device-id');

/** Where the current id came from. 当前 ID 的解析来源。 */
export type DeviceIdSource =
  /** The anchored store file hit. 稳定存储文件命中。 */
  | 'store-file'
  /** The registry mirror hit. 注册表镜像命中。 */
  | 'registry'
  /** The hardware fingerprint matched a historical id. 硬件指纹匹配命中（回收旧 ID）。 */
  | 'fingerprint'
  /** Nothing hit; a fresh random id was minted. 全部未命中，新生成随机 ID。 */
  | 'fresh';

/** The on-disk record of the stable store. 稳定存储文件的数据结构。 */
export interface DeviceIdRecord {
  /** The current device id. 当前设备 ID。 */
  id: string;
  /** Historical hardware fingerprints. 历史硬件指纹（重装系统后回收 ID）。 */
  fingerprints: string[];
  /** Epoch ms of first creation. 首次创建时间。 */
  createdAt: number;
  /** Epoch ms of the latest write. 最近一次更新时间。 */
  updatedAt: number;
}

