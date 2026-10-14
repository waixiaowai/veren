/**
 * @veren/device-id - the stable device-id plugin module.
 * @veren/device-id - 稳定设备 ID 插件模块。
 *
 * 插件约定（同 @veren/commander-*）：
 * Plugin convention (same as @veren/commander-*):
 *   - name    服务令牌（兼作插件显示名）/ the service token (doubling as the display name)
 *   - inject  依赖的服务令牌（无）/ required service tokens (none)
 *   - Config  schemastery 配置 schema / the config schema
 *   - apply   装配并提供 DeviceId 服务 / wires and provides the DeviceId service
 */

import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { DeviceIdService } from './service.js';
import type { DeviceIdOptions } from './service.js';
import { DeviceIdToken, DeviceId } from './protocol.js';
import type { DeviceIdSource } from './protocol.js';
import { defaultStoreFile } from './store.js';

export { DeviceIdToken, DeviceId } from './protocol.js';
export type { DeviceIdSource } from './protocol.js';
export { DeviceIdService } from './service.js';
export { hashToUuid } from './service.js';
export { computeFingerprint } from './fingerprint.js';

/** 服务令牌：兼作插件显示名。 The service token, doubling as the display name. */
export { DeviceIdToken as name };

/** 本插件不依赖其他能力。 This plugin injects nothing. */
export const inject = [] as const;

/** 本插件提供 DeviceId 服务。 This plugin provides the DeviceId service. */
export const provide = [DeviceIdToken] as const;

/** 归一化配置。 The normalized plugin config. */
export interface Config extends DeviceIdOptions {}

/** 配置 schema：ctx.plugin 装载时自动校验并补全缺省值。 Validated and default-filled by ctx.plugin. */
export const Config: z<Config> = z.object({
  storeFile: z.string().default(defaultStoreFile()),
});

/** 装配函数：实例化并提供 DeviceId 服务。 The apply function: instantiate and provide the service. */
export const apply = (ctx: Context, config: Config): void => {
  ctx.plugin(DeviceIdService, config);
};

