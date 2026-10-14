/**
 * Windows stable-tier fingerprint: SMBIOS UUID + baseboard serial via
 * PowerShell CIM, normalized then hashed (see @veren/device-id/hash).
 * Windows 稳定级指纹：PowerShell CIM 取 SMBIOS UUID + 主板序列号，归一化后哈希。
 *
 * Volatile sources (MachineGuid, disk serial) are deliberately excluded:
 * they are regenerated/changed by an OS reinstall or a disk swap.
 * 重装即变的来源（MachineGuid、硬盘序列号）刻意排除。
 */

import { execFileSync } from 'node:child_process';
import { hashFingerprint, normalizeId } from '@veren/device-id';

/** 极简清洗后的子进程环境（去掉密钥类变量）。 Spawn env with secret variables scrubbed. */
function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/KEY|PASSWORD|SECRET|TOKEN|^DSH_/i.test(key)) delete env[key];
  }
  return env;
}

/** 静默执行 PowerShell；失败返回 null。 Run PowerShell quietly; null on failure. */
function ps(script: string): string | null {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      timeout: 8000,
      windowsHide: true,
      env: cleanEnv(),
      encoding: 'utf8',
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

/** 采集稳定级原始标识（归一化、去重）。 Collect normalized stable-tier raw ids. */
export function collectStableIds(): string[] {
  const out: string[] = [];
  const uuid = ps('(Get-CimInstance Win32_ComputerSystemProduct).UUID');
  if (uuid) out.push('smbios:' + normalizeId(uuid));
  const board = ps('(Get-CimInstance Win32_BaseBoard | Select-Object -First 1).SerialNumber');
  if (board) out.push('board:' + normalizeId(board));
  return [...new Set(out.filter(Boolean))];
}

/** 稳定级指纹；无任何采集结果为 null。 The stable fingerprint; null when nothing collected. */
export function stableFingerprint(): string | null {
  const raw = collectStableIds();
  return raw.length > 0 ? hashFingerprint(raw) : null;
}
