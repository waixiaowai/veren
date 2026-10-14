/**
 * @veren/device-id-win - the Windows platform plugin for @veren/device-id.
 * @veren/device-id-win - @veren/device-id 的 Windows 平台插件。
 *
 * Provides the `device-id-platform` capability: the stable-tier fingerprint
 * (SMBIOS UUID + baseboard serial) and the registry anchor. Install this INSTEAD
 * of the -mac/-linux variants on Windows hosts.
 * 提供 `device-id-platform` 能力：稳定级指纹与注册表锚点。Windows 宿主安装本包
 * 而非 -mac/-linux 变体。
 */

import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { provideValue } from '@veren/core';
import { DeviceIdPlatformToken } from '@veren/device-id';
import type { DeviceIdPlatform } from '@veren/device-id';
import { stableFingerprint } from './fingerprint.js';
import { readAnchor, writeAnchor } from './anchor.js';

export { DeviceIdPlatformToken as name };

export interface Config {}
export const Config: z<Config> = z.object({});

/** Windows 平台实现。 The Windows platform implementation. */
export class WindowsPlatform implements DeviceIdPlatform {
  stableFingerprint(): string | null {
    return process.platform === 'win32' ? stableFingerprint() : null;
  }

  recoverAnchoredId(): string | null {
    return process.platform === 'win32' ? readAnchor() : null;
  }

  anchor(id: string): void {
    if (process.platform === 'win32') writeAnchor(id);
  }
}

export const apply = (ctx: Context, _config: Config): void => {
  ctx.effect(() => provideValue(ctx, DeviceIdPlatformToken, new WindowsPlatform()), DeviceIdPlatformToken);
};
