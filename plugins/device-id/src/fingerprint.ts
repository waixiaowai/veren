/**
 * Hardware fingerprint collection, in two stability tiers following common
 * open-source practice (osquery field layout, node-machine-id lessons):
 * 硬件指纹采集，按社区通行实践（osquery 字段划分、node-machine-id 的教训）
 * 分为两级稳定性：
 *
 *  - stable tier: survives an OS reinstall (SMBIOS UUID, board serial,
 *    macOS IOPlatformUUID, Linux DMI). 重装系统后仍在（固件级标识）。
 *  - soft tier: only stable within one OS install (Windows MachineGuid and
 *    disk serial, Linux /etc/machine-id). 仅单次系统安装内稳定，只作参考。
 *
 * MachineGuid is regenerated on Windows reinstall and /etc/machine-id on Linux
 * reinstall, so they must never enter the reinstall-stable fingerprint.
 * MachineGuid 与 /etc/machine-id 重装即变，绝不参与跨重装指纹。
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

/** 极简清洗后的子进程环境（去掉密钥类变量，避免泄漏）。 Spawn env: secrets scrubbed. */
function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/KEY|PASSWORD|SECRET|TOKEN|^DSH_/i.test(key)) delete env[key];
  }
  return env;
}

/** 静默执行并返回输出；失败返回 null。 Run a command quietly; null on any failure. */
function tryRun(cmd: string, args: string[], timeoutMs = 5000): string | null {
  try {
    const out = execFileSync(cmd, args, {
      timeout: timeoutMs,
      windowsHide: true,
      env: cleanEnv(),
      encoding: 'utf8',
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

/** 静默读注册表值；失败返回 null。 Read a registry value quietly; null on failure. */
function tryRegGet(path: string, value: string): string | null {
  if (process.platform !== 'win32') return null;
  const line = tryRun('reg.exe', ['query', path, '/v', value], 3000)
    ?.split(/\r?\n/)
    .find((l) => l.includes(value));
  return line?.split(/\s{2,}/).pop() ?? null;
}

/** 读取文件首行；失败返回 null。 First non-empty line of a file; null on failure. */
function tryReadLine(file: string): string | null {
  try {
    if (!existsSync(file)) return null;
    return readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).find(Boolean) ?? null;
  } catch {
    return null;
  }
}

/** 归一化：trim + 小写 + 去内部空白（node-machine-id 踩过大小写/空白坑）。 Normalize: trim, lowercase, strip whitespace. */
function norm(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '');
}

/** Windows 稳定级：SMBIOS UUID + 主板序列号。 Windows stable tier: SMBIOS UUID + board serial. */
function windowsStableIds(): string[] {
  const out: string[] = [];
  const ps = (script: string): string | null =>
    tryRun('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], 8000);
  const uuid = ps('(Get-CimInstance Win32_ComputerSystemProduct).UUID');
  if (uuid) out.push('smbios:' + norm(uuid));
  const board = ps('(Get-CimInstance Win32_BaseBoard | Select-Object -First 1).SerialNumber');
  if (board) out.push('board:' + norm(board));
  return out;
}

/** Windows 软级：MachineGuid + 首块硬盘序列号（重装即变，仅参考）。 Windows soft tier. */
function windowsSoftIds(): string[] {
  const out: string[] = [];
  const guid = tryRegGet('HKLM\\SOFTWARE\\Microsoft\\Cryptography', 'MachineGuid');
  if (guid) out.push('machine-guid:' + norm(guid));
  const disk = tryRun('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_DiskDrive | Sort-Object -Property Index | Select-Object -First 1).SerialNumber'], 8000);
  if (disk) out.push('disk:' + norm(disk));
  return out;
}

/** Linux/macOS 稳定级：DMI product_uuid、board_serial 或 IOPlatformUUID。 Stable tier for unix. */
function unixStableIds(): string[] {
  const out: string[] = [];
  if (process.platform === 'linux') {
    const uuid = tryReadLine('/sys/class/dmi/id/product_uuid');
    const board = tryReadLine('/sys/class/dmi/id/board_serial');
    // product_uuid 常需要 root；读不到时用 product_sys_serial 兜底。
    // product_uuid often needs root; fall back to product_sys_serial.
    const sysSerial = uuid ? null : tryReadLine('/sys/class/dmi/id/product_serial');
    if (uuid) out.push('smbios:' + norm(uuid));
    else if (sysSerial) out.push('sys-serial:' + norm(sysSerial));
    if (board) out.push('board:' + norm(board));
  } else if (process.platform === 'darwin') {
    const uuid = tryRun('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'])
      ?.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)?.[1];
    if (uuid) out.push('platform:' + norm(uuid));
  }
  return out;
}

/** Unix 软级：/etc/machine-id（重装即重新生成，仅参考）。 Unix soft tier: machine-id. */
function unixSoftIds(): string[] {
  if (process.platform !== 'linux') return [];
  const mid = tryReadLine('/etc/machine-id') ?? tryReadLine('/var/lib/dbus/machine-id');
  return mid ? ['machine-id:' + norm(mid)] : [];
}

/** 采集某一级的原始标识。 Collect the raw ids of one tier. */
export function collectRawIds(tier: 'stable' | 'soft'): string[] {
  const win = process.platform === 'win32';
  const stable = win ? windowsStableIds() : unixStableIds();
  if (tier === 'stable') return [...new Set(stable.filter(Boolean))];
  return [...new Set([...stable, ...(win ? windowsSoftIds() : unixSoftIds())].filter(Boolean))];
}

/** 将原始标识哈希为 64 位十六进制指纹。 Hash raw ids into a hex fingerprint. */
export function fingerprint(rawIds: readonly string[]): string {
  return createHash('sha256').update(rawIds.join('|'), 'utf8').digest('hex');
}

/**
 * 便捷入口：优先用稳定级（跨重装）；稳定级采集不到才退回软级。
 * One-shot: prefer the stable tier; fall back to soft only when empty.
 */
export function computeFingerprint(): string | null {
  const stable = collectRawIds('stable');
  if (stable.length > 0) return fingerprint(stable);
  const soft = collectRawIds('soft');
  return soft.length > 0 ? fingerprint(soft) : null;
}
