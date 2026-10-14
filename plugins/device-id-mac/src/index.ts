/**
 * @veren/device-id-mac - the macOS platform plugin for @veren/device-id.
 * @veren/device-id-mac - @veren/device-id 的 macOS 平台插件。
 *
 * Provides the `device-id-platform` capability: the IOPlatformUUID stable-tier
 * fingerprint and the Application Support anchor file. Install this INSTEAD of
 * the -win/-linux variants on macOS hosts.
 * 提供 `device-id-platform` 能力：IOPlatformUUID 稳定级指纹与 Application
 * Support 锚点文件。macOS 宿主安装本包而非 -win/-linux 变体。
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

/** macOS 平台实现。 The macOS platform implementation. */
export class MacPlatform implements DeviceIdPlatform {
  stableFingerprint(): string | null {
    return process.platform === 'darwin' ? stableFingerprint() : null;
  }

  recoverAnchoredId(): string | null {
    return process.platform === 'darwin' ? readAnchor() : null;
  }

  anchor(id: string): void {
    if (process.platform === 'darwin') writeAnchor(id);
  }
}

export const apply = (ctx: Context, _config: Config): void => {
  ctx.effect(() => provideValue(ctx, DeviceIdPlatformToken, new MacPlatform()), DeviceIdPlatformToken);
};
