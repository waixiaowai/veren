/**
 * Linux stable-tier fingerprint: DMI identifiers under /sys/class/dmi/id
 * (product_uuid preferred, product_serial as the non-root fallback,
 * board_serial when readable), normalized then hashed.
 * Linux 稳定级指纹：/sys/class/dmi/id 下的 DMI 标识（优先 product_uuid，无
 * root 时退回 product_serial，可读时加入 board_serial），归一化后哈希。
 *
 * /etc/machine-id is NOT used: an OS reinstall regenerates it.
 * 不使用 /etc/machine-id：重装系统会重新生成。
 */

import { existsSync, readFileSync } from 'node:fs';
import { hashFingerprint, normalizeId } from '@veren/device-id';

/** 读 DMI 文件首行；不存在或无权限为 null。 First line of a DMI file; null when absent or unreadable. */
export function readDmi(file: string): string | null {
  try {
    if (!existsSync(file)) return null;
    return readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).find(Boolean) ?? null;
  } catch {
    return null;
  }
}

/** 采集稳定级原始标识（归一化、去重）。 Collect normalized stable-tier raw ids. */
export function collectStableIds(read: (file: string) => string | null = readDmi): string[] {
  const out: string[] = [];
  const uuid = read('/sys/class/dmi/id/product_uuid');
  const sysSerial = uuid ? null : read('/sys/class/dmi/id/product_serial');
  const board = read('/sys/class/dmi/id/board_serial');
  if (uuid) out.push('smbios:' + normalizeId(uuid));
  else if (sysSerial) out.push('sys-serial:' + normalizeId(sysSerial));
  if (board) out.push('board:' + normalizeId(board));
  return [...new Set(out.filter(Boolean))];
}

/** 稳定级指纹；无采集结果为 null。 The stable fingerprint; null when nothing collected. */
export function stableFingerprint(): string | null {
  const raw = collectStableIds();
  return raw.length > 0 ? hashFingerprint(raw) : null;
}
