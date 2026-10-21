/**
 * @veren/device-id - the platform-agnostic device-id core plugin module.
 * @veren/device-id - 平台无关的设备 ID 核心插件模块。
 *
 * Other plugins depend on THIS package (the service token and contracts); the
 * per-OS packages (@veren/device-id-win/-mac/-linux) only supply the platform
 * capability. The host must install the matching platform plugin and mount the
 * dsh storage domain facility.
 * 其他插件只依赖本包（服务令牌与契约）；各操作系统包仅提供平台能力。宿主需
 * 安装匹配的平台插件并挂载 dsh storage domain 设施。
 */

import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { deviceIdDomain } from './domain.js';
import { DeviceIdService, portablePlatform, resolveDeviceId } from './service.js';
import { DeviceIdToken, DeviceIdPlatformToken, DeviceId } from './protocol.js';
import type { DeviceIdSource } from './protocol.js';
// 类型-only import：只为拉取 dsh-storage-domain 的 declaration merging（ctx.storageDomain）。
// type-only import: pulls the declaration merge that declares ctx.storageDomain.
import type {} from '@deepseek-ai/dsh-storage-domain';

export { DeviceIdToken, DeviceIdPlatformToken, DeviceId } from './protocol.js';
export type { DeviceIdSource, DeviceIdRecord, DeviceIdPlatform } from './protocol.js';
export { resolveDeviceId, DeviceIdService } from './service.js';
export { deviceIdDomain } from './domain.js';
export { normalizeId, hashFingerprint, hashToUuid } from './hash.js';

/** 服务令牌：兼作插件显示名。 The service token, doubling as the display name. */
export { DeviceIdToken as name };

/**
 * 依赖：dsh storage domain 设施。平台能力是可选增强：未安装时使用
 * {@link portablePlatform} 兜底，插件仍能提供稳定的持久 ID。
 * Dependencies: the dsh storage domain facility. The platform capability is an
 * optional enhancement: without it {@link portablePlatform} keeps the plugin
 * loadable and the durable ID stable.
 */
export const inject = ['storageDomain'] as const;

/** 本插件提供 DeviceId 服务。 This plugin provides the DeviceId service. */
export const provide = [DeviceIdToken] as const;

/** 归一化配置。 The normalized plugin config. */
export interface Config {}

/** 配置 schema。 The config schema. */
export const Config: z<Config> = z.object({});

/**
 * 装配：打开 domain -> 解析 -> 持久写回 -> 提供服务。
 * Apply: open the domain -> resolve -> durable write-back -> provide the service.
 */
export const apply = async (ctx: Context, _config: Config): Promise<void> => {
  const domain = await ctx.storageDomain.open(deviceIdDomain);
  // `global` 由 spec 推导（DomainGlobalHandleOf）：不写断言、不重复声明记录类型。
  // `global` is derived from the spec (DomainGlobalHandleOf): no cast, no second copy.
  const globalStore = domain.global;
  const platform = ctx.get(DeviceIdPlatformToken) ?? portablePlatform;
  const resolved = resolveDeviceId({ stored: globalStore.get(), platform, now: Date.now() });
  const service = new DeviceIdService(ctx, resolved.id, resolved.source, globalStore, platform);
  await service.persist(resolved.record);
  // 卸载时关闭 domain（幂等）。 Close the domain on unload (idempotent).
  ctx.effect(() => async () => { await domain.close(); }, 'device-id/domain');
};






