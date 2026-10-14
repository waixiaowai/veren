/**
 * Windows out-of-band anchor: the id mirrored into HKCU\\Software\\Veren\\DeviceId.
 * Windows 带外锚点：ID 镜像到 HKCU\\Software\\Veren\\DeviceId。
 */

import { execFileSync } from 'node:child_process';

/** 锚点注册表路径。 The anchor registry path. */
export const ANCHOR_PATH = 'HKCU\\Software\\Veren\\DeviceId';
/** ID 合法形状（UUID）。 The accepted id shape (a UUID). */
const ID_RE = /^[0-9a-f-]{16,64}$/i;

/** 读锚点；不存在或损坏为 null。 Read the anchor; null when absent or corrupt. */
export function readAnchor(): string | null {
  try {
    const out = execFileSync('reg.exe', ['query', ANCHOR_PATH, '/v', 'id'], {
      timeout: 3000,
      windowsHide: true,
      encoding: 'utf8',
    });
    const line = out.split(/\r?\n/).find((l) => l.includes('id'));
    const value = line?.split(/\s{2,}/).pop();
    return value && ID_RE.test(value) ? value : null;
  } catch {
    return null;
  }
}

/** 尽力而为写锚点；失败静默。 Anchor best-effort; silent on failure. */
export function writeAnchor(id: string): void {
  try {
    execFileSync('reg.exe', ['add', ANCHOR_PATH, '/v', 'id', '/t', 'REG_SZ', '/d', id, '/f'], {
      timeout: 3000,
      windowsHide: true,
    });
  } catch {
    // 锚点写入失败不影响主流程 / a failed anchor write never breaks the main flow
  }
}
