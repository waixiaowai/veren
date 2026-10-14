/**
 * macOS platform unit tests (pure parts; guarded by process.platform).
 * macOS 平台单元测试（纯逻辑部分；按平台守卫）。
 */

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { anchorFile } from '../src/anchor.js';
import { MacPlatform } from '../src/index.js';

describe('anchor file | 锚点文件', () => {
  it('lives under Application Support/veren | 位于 Application Support/veren 下', () => {
    expect(anchorFile()).toContain(join('veren', 'device-id.anchor'));
  });
});

describe('MacPlatform guards | 平台守卫', () => {
  it('is inert off-macOS | 非 macOS 平台全部退化为空', () => {
    if (process.platform === 'darwin') return;
    const p = new MacPlatform();
    expect(p.stableFingerprint()).toBeNull();
    expect(p.recoverAnchoredId()).toBeNull();
    expect(() => p.anchor('x')).not.toThrow();
  });
});

