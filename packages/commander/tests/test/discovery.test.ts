/**
 * 训练场发现测试：list 与 show 的托管状态报告。
 *
 * Training-ground discovery tests: managed-state reporting of list and show.
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTrainingGround, listTrainingGrounds, readTrainingGround } from '../src/ground';
import { createDeps, createOptions, makeWorkspace, removeWorkspace, type WorkspaceFixtures } from './helpers';

let fx: WorkspaceFixtures;

beforeEach(() => {
  fx = makeWorkspace();
});

afterEach(() => {
  removeWorkspace(fx);
});

describe('训练场发现 / training-ground discovery', () => {
  it('list 与 show 返回托管状态 / list and show report management state', async () => {
    await createTrainingGround(createOptions(fx, 'alpha'), createDeps(fx));
    mkdirSync(join(fx.root, 'manual'), { recursive: true });

    const listed = await listTrainingGrounds(fx.root);
    expect(listed.map((entry) => [entry.name, entry.managed])).toEqual([
      ['alpha', true],
      ['manual', false],
    ]);
    expect(listed[0]).toMatchObject({ sourceProfile: 'desktop', hasCredentials: true, hasProfile: true });

    const ground = await readTrainingGround(fx.root, 'alpha');
    expect(ground.summary.path).toBe(join(fx.root, 'alpha'));
    expect(ground.meta?.sourceProfile).toBe('desktop');
  });
});
