/**
 * macOS out-of-band anchor: a small marker file in the user's Application
 * Support (recovers the id when the domain medium is wiped on the same OS).
 * macOS 带外锚点：用户 Application Support 下的标记文件（同系统内 domain 介质
 * 被清空时回收 ID）。
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** 锚点文件路径。 The anchor file path. */
export function anchorFile(): string {
  return join(homedir(), 'Library', 'Application Support', 'veren', 'device-id.anchor');
}

/** 读锚点；不存在或损坏为 null。 Read the anchor; null when absent or corrupt. */
export function readAnchor(): string | null {
  try {
    if (!existsSync(anchorFile())) return null;
    const value = readFileSync(anchorFile(), 'utf8').trim();
    return /^[0-9a-f-]{16,64}$/i.test(value) ? value : null;
  } catch {
    return null;
  }
}

/** 尽力而为写锚点；失败静默。 Anchor best-effort; silent on failure. */
export function writeAnchor(id: string): void {
  try {
    mkdirSync(dirname(anchorFile()), { recursive: true });
    writeFileSync(anchorFile(), id, 'utf8');
  } catch {
    // 锚点写入失败不影响主流程 / a failed anchor write never breaks the main flow
  }
}
