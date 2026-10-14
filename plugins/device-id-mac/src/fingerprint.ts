/**
 * macOS stable-tier fingerprint: IOPlatformUUID via ioreg - firmware level,
 * survives an OS reinstall. macOS 稳定级指纹：ioreg 读 IOPlatformUUID，固件级，
 * 重装系统不丢。
 */

import { execFileSync } from 'node:child_process';
import { hashFingerprint, normalizeId } from '@veren/device-id';

/** 静默执行命令；失败返回 null。 Run a command quietly; null on failure. */
function tryRun(cmd: string, args: string[]): string | null {
  try {
    return execFileSync(cmd, args, { timeout: 5000, encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
}

/** 采集稳定级原始标识。 Collect the stable-tier raw ids. */
export function collectStableIds(): string[] {
  const out: string[] = [];
  const uuid = tryRun('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'])
    ?.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)?.[1];
  if (uuid) out.push('platform:' + normalizeId(uuid));
  return out.filter(Boolean);
}

/** 稳定级指纹；无采集结果为 null。 The stable fingerprint; null when nothing collected. */
export function stableFingerprint(): string | null {
  const raw = collectStableIds();
  return raw.length > 0 ? hashFingerprint(raw) : null;
}
