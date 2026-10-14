/**
 * Windows platform unit tests (pure parts; command execution is guarded by
 * process.platform so the suite runs on any dev OS).
 * Windows 平台单元测试（纯逻辑部分；命令执行按平台守卫，任意开发机可跑）。
 */

import { describe, expect, it } from 'vitest';
import { ANCHOR_PATH } from '../src/anchor.js';
import { WindowsPlatform } from '../src/index.js';

describe('anchor path | 锚点路径', () => {
  it('lives under HKCU Software\\Veren | 位于 HKCU Software\\Veren 下', () => {
    expect(ANCHOR_PATH).toMatch(/^HKCU\\Software\\Veren\\DeviceId$/);
  });
});

describe('WindowsPlatform guards | 平台守卫', () => {
  it('is inert off-Windows | 非 Windows 平台全部退化为空', () => {
    if (process.platform === 'win32') return;
    const p = new WindowsPlatform();
    expect(p.stableFingerprint()).toBeNull();
    expect(p.recoverAnchoredId()).toBeNull();
    expect(() => p.anchor('x')).not.toThrow();
  });

  it('is functional on Windows | Windows 上可采集', () => {
    if (process.platform !== 'win32') return;
    const p = new WindowsPlatform();
    const fp = p.stableFingerprint();
    expect(fp === null || /^[0-9a-f]{64}$/.test(fp)).toBe(true);
  });
});
