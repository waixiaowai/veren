/**
 * Linux platform unit tests: DMI reads are injectable, so fingerprint logic is
 * testable on any dev OS.
 * Linux 平台单元测试：DMI 读取可注入，指纹逻辑可在任意开发机测试。
 */

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { anchorFile } from '../src/anchor.js';
import { collectStableIds } from '../src/fingerprint.js';
import { LinuxPlatform } from '../src/index.js';

describe('collectStableIds | DMI 采集', () => {
  it('uses product_uuid + board_serial | 使用 product_uuid 与 board_serial', () => {
    const ids = collectStableIds((f) => (f.endsWith('product_uuid') ? ' UUID-1234 ' : f.endsWith('board_serial') ? 'BOARD/9' : null));
    expect(ids).toEqual(['smbios:uuid-1234', 'board:board/9']);
  });

  it('falls back to product_serial without root | 无 root 时退回 product_serial', () => {
    const ids = collectStableIds((f) => (f.endsWith('product_serial') ? 'SER 42' : null));
    expect(ids).toEqual(['sys-serial:ser42']);
  });

  it('never uses /etc/machine-id | 绝不使用 /etc/machine-id', () => {
    const ids = collectStableIds((f) => (f.includes('machine-id') ? 'volatile' : null));
    expect(ids).toEqual([]);
  });
});

describe('anchor file | 锚点文件', () => {
  it('lives under ~/.local/state/veren | 位于 ~/.local/state/veren 下', () => {
    expect(anchorFile('/home/u')).toBe(join('/home/u', '.local', 'state', 'veren', 'device-id.anchor'));
  });
});

describe('LinuxPlatform guards | 平台守卫', () => {
  it('is inert off-Linux | 非 Linux 平台全部退化为空', () => {
    if (process.platform === 'linux') return;
    const p = new LinuxPlatform();
    expect(p.stableFingerprint()).toBeNull();
    expect(p.recoverAnchoredId()).toBeNull();
    expect(() => p.anchor('x')).not.toThrow();
  });
});

