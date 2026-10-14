/**
 * @veren/device-id-linux - the Linux platform plugin for @veren/device-id.
 * @veren/device-id-linux - @veren/device-id 的 Linux 平台插件。
 *
 * Provides the `device-id-platform` capability: the DMI stable-tier
 * fingerprint and the ~/.local/state anchor file. Install this INSTEAD of the
 * -win/-mac variants on Linux hosts.
 * 提供 `device-id-platform` 能力：DMI 稳定级指纹与 ~/.local/state 锚点文件。
 * Linux 宿主安装本包而非 -win/-mac 变体。
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

/** Linux 平台实现。 The Linux platform implementation. */
export class LinuxPlatform implements DeviceIdPlatform {
  stableFingerprint(): string | null {
    return process.platform === 'linux' ? stableFingerprint() : null;
  }

  recoverAnchoredId(): string | null {
    return process.platform === 'linux' ? readAnchor() : null;
  }

  anchor(id: string): void {
    if (process.platform === 'linux') writeAnchor(id);
  }
}

export const apply = (ctx: Context, _config: Config): void => {
  ctx.effect(() => provideValue(ctx, DeviceIdPlatformToken, new LinuxPlatform()), DeviceIdPlatformToken);
};
