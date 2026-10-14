/**
 * Unit tests for the resolution policy and the shared hashing helpers.
 * 解析策略与共享哈希工具的单元测试。
 */

import { describe, expect, it } from 'vitest';
import { hashFingerprint, hashToUuid, normalizeId } from '../src/hash.js';
import { resolveDeviceId } from '../src/service.js';
import { deviceIdDomain, EMPTY_RECORD } from '../src/domain.js';
import type { DeviceIdPlatform, DeviceIdRecord } from '../src/protocol.js';

/** Stub platform. 平台桩。 */
function platform(overrides: Partial<DeviceIdPlatform> = {}): DeviceIdPlatform {
  return {
    stableFingerprint: () => null,
    recoverAnchoredId: () => null,
    anchor: () => {},
    ...overrides,
  };
}

const NOW = 1_000;

describe('resolveDeviceId | 解析策略', () => {
  it('tier 1: domain store hit wins | 第一级：domain 存储命中', () => {
    const stored: DeviceIdRecord = { id: 'stored-id', fingerprints: ['fp-old'], createdAt: 1, updatedAt: 1 };
    const r = resolveDeviceId({ stored, platform: platform({ stableFingerprint: () => 'fp-new' }), now: NOW });
    expect(r.id).toBe('stored-id');
    expect(r.source).toBe('domain-store');
    expect(r.record.fingerprints).toContain('fp-new');
    expect(r.record.fingerprints.length).toBeLessThanOrEqual(8);
  });

  it('tier 1 keeps at most 8 fingerprints | 第一级指纹滚动截断到 8', () => {
    const stored: DeviceIdRecord = { id: 'stored-id', fingerprints: Array.from({ length: 8 }, (_, i) => `fp${i}`), createdAt: 1, updatedAt: 1 };
    const r = resolveDeviceId({ stored, platform: platform({ stableFingerprint: () => 'fp-new' }), now: NOW });
    expect(r.record.fingerprints.length).toBe(8);
    expect(r.record.fingerprints[0]).toBe('fp1');
  });

  it('tier 2: platform anchor recovers | 第二级：平台锚点回收', () => {
    const r = resolveDeviceId({
      stored: EMPTY_RECORD,
      platform: platform({ recoverAnchoredId: () => 'anchored-id' }),
      now: NOW,
    });
    expect(r.id).toBe('anchored-id');
    expect(r.source).toBe('platform-anchor');
  });

  it('tier 3: fingerprint derives deterministically | 第三级：指纹确定性派生', () => {
    const args = { stored: EMPTY_RECORD, platform: platform({ stableFingerprint: () => 'deadbeef' }), now: NOW };
    const a = resolveDeviceId(args);
    const b = resolveDeviceId(args);
    expect(a.id).toBe(b.id);
    expect(a.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.source).toBe('fingerprint');
    expect(a.record.fingerprints).toEqual(['deadbeef']);
  });

  it('tier 4: fresh random when nothing collected | 第四级：全部未命中则新随机', () => {
    const r = resolveDeviceId({ stored: EMPTY_RECORD, platform: platform(), now: NOW });
    expect(r.source).toBe('fresh');
    expect(r.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('shared hash helpers | 共享哈希工具', () => {
  it('normalizeId trims, lowercases and strips whitespace | 归一化', () => {
    expect(normalizeId('  AB-CD  EF ')).toBe('ab-cdef');
  });

  it('hashFingerprint is order-sensitive and deterministic | 指纹确定性且对顺序敏感', () => {
    expect(hashFingerprint(['a', 'b'])).toBe(hashFingerprint(['a', 'b']));
    expect(hashFingerprint(['a', 'b'])).not.toBe(hashFingerprint(['b', 'a']));
  });

  it('hashToUuid is uuid-shaped | UUID 形状', () => {
    expect(hashToUuid('ff')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('domain spec | domain 声明', () => {
  it('name matches UNIT_NAME_RE and global initial has an empty id | 域名合法且初始为空', () => {
    expect(deviceIdDomain.name).toBe('device_id');
    expect(deviceIdDomain.name).toMatch(/^[a-z][a-z0-9_]*$/);
    expect(EMPTY_RECORD.id).toBe('');
  });
});
