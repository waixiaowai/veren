/**
 * 训练场创建测试：密钥/模型配置复制、dry-run、失败清理与参数校验。
 *
 * Training-ground creation tests: credentials/model-config copying, dry runs,
 * failure cleanup and argument validation.
 */

import { existsSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTrainingGround } from '../src/ground';
import type { TrainingGroundRef } from '../src/ground';
import {
  createDeps,
  createOptions,
  makeWorkspace,
  removeWorkspace,
  targetPatch,
  type WorkspaceFixtures,
} from './helpers';

let fx: WorkspaceFixtures;

beforeEach(() => {
  fx = makeWorkspace();
});

afterEach(() => {
  removeWorkspace(fx);
});

describe('训练场创建 / training-ground creation', () => {
  it('复制密钥、模型配置并初始化 profile / copies credentials, model configuration and initializes the profile', async () => {
    const result = await createTrainingGround(createOptions(fx, 'alpha'), createDeps(fx));

    expect(result).toMatchObject({ dryRun: false, name: 'alpha', profile: 'web', sourceProfile: 'desktop' });
    expect(result.copied).toEqual(expect.arrayContaining(['credentials', 'env', 'settings', 'profile-npmrc', 'model-patch:desktop']));
    expect(fx.fake.callCount).toBe(1);
    expect(readFileSync(join(fx.root, 'alpha', '.credentials.yaml'), 'utf8')).toBe(
      'version: 1\nrefs:\n  TEST_API_KEY: secret\n',
    );
    expect(existsSync(join(fx.root, 'alpha', '.env'))).toBe(true);
    expect(existsSync(join(fx.root, 'alpha', 'settings.yaml'))).toBe(true);

    const patch = targetPatch(fx.root, 'alpha');
    expect(patch.map((entry) => entry.id)).toEqual(['llm-pi-ai', 'agent-default-model']);
    expect(patch[0]).toMatchObject({ config: { providers: { test: { apiKeyEnv: 'TEST_API_KEY' } } } });

    const npmrc = readFileSync(join(fx.root, 'alpha', 'profiles', 'web', '.npmrc'), 'utf8');
    expect(npmrc).toContain('package-import-method=copy');
    expect(npmrc).toContain('@veren:registry=https://npm.veren.top/');
    expect(npmrc).toContain('//npm.veren.top/:_authToken=registry-token');
    expect(npmrc).not.toContain('C:/old/store');
    expect(npmrc).toContain(join(fx.root, 'alpha', '.pnpm-store').replaceAll('\\', '/'));

    const meta = JSON.parse(readFileSync(join(fx.root, 'alpha', '.veren-tests.json'), 'utf8')) as Record<string, unknown>;
    expect(meta).toMatchObject({ version: 1, name: 'alpha', sourceProfile: 'desktop', profile: 'web' });
  });

  it('保留目标 profile 已有的非模型补丁项并覆盖同 id 的模型项 / keeps unrelated target entries and replaces same-id model entries', async () => {
    const initProfile = async (ground: TrainingGroundRef): Promise<void> => {
      await fx.fake.init(ground);
      writeFileSync(
        join(ground.path, 'profiles', ground.profile, 'cordis.patch.yml'),
        [
          '- id: ui-settings-general',
          '  name: "@deepseek-ai/dsh-client-ui-settings-general"',
          '  config:',
          '    welcomeNoticeVersion: old',
          '- id: llm-pi-ai',
          '  name: "@deepseek-ai/dsh-llm-pi-ai"',
          '  config:',
          '    providers:',
          '      old: {}',
          '',
        ].join('\n'),
      );
    };
    await createTrainingGround(createOptions(fx, 'beta'), createDeps(fx, initProfile));

    const patch = targetPatch(fx.root, 'beta');
    expect(patch.map((entry) => entry.id)).toEqual(['ui-settings-general', 'llm-pi-ai', 'agent-default-model']);
    expect(patch[0]).toMatchObject({ config: { welcomeNoticeVersion: 'old' } });
    expect(patch[1]).toMatchObject({ config: { providers: { test: { apiKeyEnv: 'TEST_API_KEY' } } } });
  });

  it('预检不写磁盘 / a dry run writes nothing', async () => {
    const result = await createTrainingGround({ ...createOptions(fx, 'dry'), dryRun: true }, createDeps(fx));
    expect(result).toMatchObject({ dryRun: true, sourceProfile: 'desktop' });
    expect(existsSync(join(fx.root, 'dry'))).toBe(false);
    expect(fx.fake.callCount).toBe(0);
  });

  it('初始化失败时清理本次创建的目录 / removes the directory created by a failed run', async () => {
    const failing = async (): Promise<void> => { throw new Error('init failed'); };
    await expect(createTrainingGround(createOptions(fx, 'broken'), createDeps(fx, failing))).rejects.toThrow('init failed');
    expect(existsSync(join(fx.root, 'broken'))).toBe(false);
  });

  it('拒绝重名与非法名 / rejects duplicates and invalid names', async () => {
    await createTrainingGround(createOptions(fx, 'alpha'), createDeps(fx));
    await expect(createTrainingGround(createOptions(fx, 'alpha'), createDeps(fx))).rejects.toMatchObject({
      code: 'TRAINING_EXISTS',
    });
    await expect(createTrainingGround(createOptions(fx, '../escape'), createDeps(fx))).rejects.toMatchObject({
      code: 'TRAINING_INVALID_NAME',
    });
    await expect(createTrainingGround(createOptions(fx, 'con'), createDeps(fx))).rejects.toMatchObject({
      code: 'TRAINING_INVALID_NAME',
    });
  });

  it('缺少源密钥时立即失败 / fails fast when the source has no credentials', async () => {
    rmSync(join(fx.sourceHome, '.credentials.yaml'));
    await expect(createTrainingGround(createOptions(fx, 'nokey'), createDeps(fx))).rejects.toMatchObject({
      code: 'SOURCE_CREDENTIALS_NOT_FOUND',
    });
    expect(existsSync(join(fx.root, 'nokey'))).toBe(false);
  });
});
