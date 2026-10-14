/**
 * Persistence of the device-id record: an anchored store file plus a registry
 * mirror.
 * 设备 ID 记录持久化：锚定存储文件 + 注册表镜像。
 *
 * Stability contract (requirement: the id must not change without an OS
 * reinstall): the store file is the primary anchor - once written, every later
 * generation returns the same id.
 * 稳定性契约（重装系统外 ID 不得变化）：存储文件是第一锚点 - 一旦写入，后续
 * 多次生成都返回同一 ID。
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { DeviceIdRecord } from './protocol.js';

/** Windows 下锚定到 ProgramData（所有用户可见、卸载不随应用目录删除）；否则 ~/.local/state。 */
export function defaultStoreFile(): string {
  if (process.platform === 'win32') {
    return join(process.env['ProgramData'] ?? join(process.env['SystemDrive'] ?? 'C:', 'ProgramData'), 'veren', 'device-id.json');
  }
  return join(homedir(), '.local', 'state', 'veren', 'device-id.json');
}

/** 校验并归一化磁盘记录；损坏即视为不存在。 Validate a parsed record; corrupt means absent. */
export function parseRecord(raw: unknown): DeviceIdRecord | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r['id'] !== 'string' || !/^[0-9a-f-]{16,64}$/i.test(r['id'])) return null;
  const fps = Array.isArray(r['fingerprints']) ? r['fingerprints'].filter((f): f is string => typeof f === 'string') : [];
  const createdAt = typeof r['createdAt'] === 'number' ? r['createdAt'] : Date.now();
  const updatedAt = typeof r['updatedAt'] === 'number' ? r['updatedAt'] : createdAt;
  return { id: r['id'], fingerprints: [...new Set(fps)], createdAt, updatedAt };
}

/** 读取存储文件记录。 Read the store-file record. */
export function readStoreFile(file: string): DeviceIdRecord | null {
  try {
    if (!existsSync(file)) return null;
    return parseRecord(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return null;
  }
}

/** 原子性写入（临时文件 + 重命名）。 Write atomically via tmp file + rename. */
export function writeStoreFile(file: string, record: DeviceIdRecord): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  writeFileSync(tmp, JSON.stringify(record, null, 2), 'utf8');
  renameSync(tmp, file);
}

/** 注册表镜像路径（HKCU，无需管理员）。 Registry mirror path (HKCU, no elevation). */
export function registryPath(): string {
  return 'HKCU\\Software\\Veren\\DeviceId';
}

/** 读注册表镜像中保存的 ID。 Read the mirrored id from the registry. */
export function readRegistryId(): string | null {
  if (process.platform !== 'win32') return null;
  try {
    const out = execFileSync('reg.exe', ['query', registryPath(), '/v', 'id'], {
      timeout: 3000,
      windowsHide: true,
      encoding: 'utf8',
    });
    const line = out.split(/\r?\n/).find((l) => l.includes('id'));
    const value = line?.split(/\s{2,}/).pop();
    return value && /^[0-9a-f-]{16,64}$/i.test(value) ? value : null;
  } catch {
    return null;
  }
}

/** 写注册表镜像；失败静默（镜像不是必需品）。 Mirror the id into the registry; silent on failure. */
export function writeRegistryId(id: string): void {
  if (process.platform !== 'win32') return;
  try {
    execFileSync('reg.exe', ['add', registryPath(), '/v', 'id', '/t', 'REG_SZ', '/d', id, '/f'], {
      timeout: 3000,
      windowsHide: true,
    });
  } catch {
    // 镜像写入失败不影响主流程 / a failed mirror write never breaks the main flow
  }
}


