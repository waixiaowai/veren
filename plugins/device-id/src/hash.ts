/**
 * Pure hashing helpers shared with the platform plugins.
 * 与各平台插件共享的纯哈希工具。
 */

import { createHash } from 'node:crypto';

/** Normalize a raw identifier before hashing: trim, lowercase, no whitespace. 哈希前归一化：trim + 小写 + 去空白。 */
export function normalizeId(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '');
}

/** Hash raw ids into a hex fingerprint; order matters. 将原始标识按序哈希为十六进制指纹。 */
export function hashFingerprint(rawIds: readonly string[]): string {
  return createHash('sha256').update(rawIds.join('|'), 'utf8').digest('hex');
}

/** Map a fingerprint hash deterministically into a UUID-v5-shaped id. 将指纹哈希确定性映射为 UUID v5 形状。 */
export function hashToUuid(hex: string): string {
  const h = createHash('sha256').update('veren-device-id:' + hex, 'utf8').digest('hex').slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
