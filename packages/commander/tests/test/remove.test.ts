/**
 * 训练场清理测试：--yes 授权、当前 DSH_HOME 保护与未托管目录的 --force。
 *
 * Training-ground removal tests: --yes authorization, active-DSH_HOME
 * protection and --force for unmanaged directories.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTrainingGround, removeTrainingGround } from '../src/ground';
import { createDeps, createOptions, makeWorkspace, removeWorkspace, type WorkspaceFixtures } from './helpers';

let fx: WorkspaceFixtures;

beforeEach(() => {
  fx = makeWorkspace();
});

afterEach(() => {
  removeWorkspace(fx);
});

describe('训练场清理 / training-ground removal', () => {
  it('缺少 --yes 时拒绝删除 / refuses removal without --yes', async () => {
    await createTrainingGround(createOptions(fx, 'alpha'), createDeps(fx));
    await expect(
      removeTrainingGround({ root: fx.root, name: 'alpha', yes: false, force: false, dryRun: false }),
    ).rejects.toMatchObject({ code: 'TRAINING_AUTHORIZATION_REQUIRED' });
    expect(existsSync(join(fx.root, 'alpha'))).toBe(true);
  });

  it('禁止删除当前 DSH_HOME / refuses to remove the active DSH_HOME', async () => {
    await createTrainingGround(createOptions(fx, 'alpha'), createDeps(fx));
    await expect(
      removeTrainingGround({
        root: fx.root,
        name: 'alpha',
        yes: true,
        force: false,
        dryRun: false,
        currentHome: join(fx.root, 'alpha'),
      }),
    ).rejects.toMatchObject({ code: 'TRAINING_IN_USE' });
  });

  it('未托管目录需要 --force / unmanaged directories need --force', async () => {
    mkdirSync(join(fx.root, 'manual'), { recursive: true });
    await expect(
      removeTrainingGround({ root: fx.root, name: 'manual', yes: true, force: false, dryRun: false }),
    ).rejects.toMatchObject({ code: 'TRAINING_UNMANAGED' });
    await removeTrainingGround({ root: fx.root, name: 'manual', yes: true, force: true, dryRun: false });
    expect(existsSync(join(fx.root, 'manual'))).toBe(false);
  });

  it('授权后删除托管训练场 / removes a managed ground after authorization', async () => {
    await createTrainingGround(createOptions(fx, 'alpha'), createDeps(fx));
    const result = await removeTrainingGround({ root: fx.root, name: 'alpha', yes: true, force: false, dryRun: false });
    expect(result.removed).toBe(true);
    expect(existsSync(join(fx.root, 'alpha'))).toBe(false);
  });
});
