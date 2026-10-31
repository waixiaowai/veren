/**
 * 路径与环境安全测试：训练场根重叠防护、缺省根、路径越界与环境净洗。
 *
 * Path and environment safety tests: root-overlap protection, the default
 * root, path-escape protection and environment cleaning.
 */

import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanEnvironment } from '../src/dsh';
import { resolveTrainingDir, resolveTrainingPaths } from '../src/ground';
import { makeWorkspace, removeWorkspace, type WorkspaceFixtures } from './helpers';

let fx: WorkspaceFixtures;

beforeEach(() => {
  fx = makeWorkspace();
});

afterEach(() => {
  removeWorkspace(fx);
});

describe('路径与环境安全 / path and environment safety', () => {
  it('拒绝训练场根与源 DSH_HOME 重叠 / rejects a root overlapping the source DSH home', () => {
    expect(() => resolveTrainingPaths(
      { root: fx.sourceHome, sourceHome: fx.sourceHome, harnessRoot: fx.harnessRoot, profile: 'web' },
      fx.workspace,
    )).toThrowError(/overlap/);
    expect(() => resolveTrainingPaths(
      { root: join(fx.sourceHome, 'nested'), sourceHome: fx.sourceHome, harnessRoot: fx.harnessRoot, profile: 'web' },
      fx.workspace,
    )).toThrowError(/overlap/);
  });

  it('缺省根是 <repo>/deepseek/.dsh / the default root is <repo>/deepseek/.dsh', () => {
    vi.stubEnv('VEREN_TESTS_ROOT', '');
    try {
      const paths = resolveTrainingPaths(
        { root: '', sourceHome: fx.sourceHome, harnessRoot: '', profile: '' },
        join(fx.workspace, 'repo'),
      );
      expect(paths.root).toBe(join(fx.workspace, 'repo', 'deepseek', '.dsh'));
      expect(paths.profile).toBe('web');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('训练场名始终限制在根下 / a training-ground name stays under the root', () => {
    expect(resolveTrainingDir(fx.root, 'alpha')).toBe(join(fx.root, 'alpha'));
    expect(() => resolveTrainingDir(fx.root, 'a/b')).toThrowError(/invalid training-ground name/);
    expect(() => resolveTrainingDir(fx.root, '.hidden')).toThrowError(/invalid training-ground name/);
  });

  it('清理环境剥掉 DSH_* 与疑似密钥 / the cleaned environment strips DSH_* and secret-looking names', () => {
    const cleaned = cleanEnvironment({
      PATH: '/bin',
      DSH_HOME: '/home/.dsh',
      DSh_TEST: '1',
      DEEPSEEK_API_KEY: 'secret',
      TOKENAV_API_KEY: 'secret',
      SAFE_VALUE: 'ok',
    });
    expect(cleaned).toEqual({ PATH: '/bin', SAFE_VALUE: 'ok' });
  });
});
