/**
 * Fingerprint tier tests. 指纹分级测试。
 */

import { describe, expect, it } from 'vitest';
import { collectRawIds, fingerprint } from '../src/fingerprint.js';

describe('fingerprint tiers | 指纹分级', () => {
  it('stable tier yields normalized ids | 稳定级输出已归一化的标识', () => {
    const ids = collectRawIds('stable');
    for (const id of ids) {
      expect(id).toBe(id.trim());
      expect(id).toBe(id.toLowerCase());
      expect(id).not.toMatch(/\s/);
    }
  });

  it('stable tier has no reinstall-volatile sources | 稳定级不含重装即变的来源', () => {
    const ids = collectRawIds('stable');
    expect(ids.some((id) => id.startsWith('machine-guid:') || id.startsWith('disk:') || id.startsWith('machine-id:'))).toBe(false);
  });

  it('fingerprint is deterministic | 指纹是确定性的', () => {
    expect(fingerprint(['a', 'b'])).toBe(fingerprint(['a', 'b']));
    expect(fingerprint(['a', 'b'])).not.toBe(fingerprint(['b', 'a']));
  });
});
