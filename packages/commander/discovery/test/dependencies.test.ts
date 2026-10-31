/**
 * 子包依赖提取测试：dependencies 名单提取与第三方依赖单元的解析回退。
 *
 * Sub-package dependency extraction tests: dependencies name extraction and
 * third-party dependency unit resolution fallbacks.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, afterEach, describe, expect, it } from 'vitest';
import type { FileSystem } from '@deepseek-ai/dsh-fs';
import { parseNpmDependencyNames, readDependencyUnit, readUnitDependencyNames } from '../src/deps';
import { cleanRoots, createLocalFs, makeRoot } from './helpers';

/** 注入的 ctx.fs 文件系统服务（dsh-fs 本地后端）/ the injected ctx.fs filesystem service (the dsh-fs local backend) */
let fs: FileSystem;

beforeAll(() => {
  fs = createLocalFs();
});

afterEach(() => {
  cleanRoots();
});

describe('parseNpmDependencyNames / readUnitDependencyNames', () => {
  it('提取 dependencies 的依赖名并去重 / extracts dependency names of dependencies, deduplicated', () => {
    expect(parseNpmDependencyNames(JSON.stringify({ dependencies: { a: '^1', b: 'workspace:*' } }))).toEqual(['a', 'b']);
  });

  it('无 dependencies 字段时返回空数组 / returns an empty array without a dependencies field', () => {
    expect(parseNpmDependencyNames(JSON.stringify({ name: 'x' }))).toEqual([]);
  });

  it('读取子包目录的依赖名；无 package.json 返回空数组 / reads sub-package deps; empty array without package.json', async () => {
    const root = makeRoot();
    const dir = join(root, 'pkg');
    mkdirSync(dir);
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { '@x/core': 'workspace:*' } }));
    expect(await readUnitDependencyNames(fs, dir)).toEqual(['@x/core']);
    const empty = join(root, 'empty');
    mkdirSync(empty);
    expect(await readUnitDependencyNames(fs, empty)).toEqual([]);
  });

  it('readDependencyUnit：优先子包自身 node_modules，缺失时兜底 / prefers the sub-package node_modules, falls back when absent', async () => {
    const root = makeRoot();
    const unitDir = join(root, 'pkg');
    mkdirSync(join(unitDir, 'node_modules', 'yaml'), { recursive: true });
    writeFileSync(join(unitDir, 'node_modules', 'yaml', 'package.json'), JSON.stringify({ name: 'yaml', description: 'YAML parser' }));
    expect(await readDependencyUnit(fs, root, [unitDir, root], 'yaml')).toEqual({
      name: 'yaml',
      description: 'YAML parser',
      dir: 'pkg/node_modules/yaml',
    });

    // 子包内没有：回退项目根 node_modules / not in the sub-package: fall back to the root node_modules
    mkdirSync(join(root, 'node_modules', 'zod'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'zod', 'package.json'), JSON.stringify({ name: 'zod', description: 'Schema validation' }));
    expect(await readDependencyUnit(fs, root, [unitDir, root], 'zod')).toEqual({
      name: 'zod',
      description: 'Schema validation',
      dir: 'node_modules/zod',
    });

    // 两处都没有元数据：空 description 兜底 / no metadata anywhere: empty-description fallback
    expect(await readDependencyUnit(fs, root, [unitDir, root], 'missing')).toEqual({
      name: 'missing',
      description: '',
      dir: 'node_modules/missing',
    });
  });
});
