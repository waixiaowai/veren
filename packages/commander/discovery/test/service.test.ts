/**
 * DiscoveryService 插件测试：经 ctx.plugin 装载后的 list / find 与配置项。
 *
 * DiscoveryService plugin tests: list / find and the config options after
 * installation via ctx.plugin.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanRoots, disposeFibers, install, makeRoot } from './helpers';

afterEach(async () => {
  await disposeFibers();
  cleanRoots();
});

describe('DiscoveryService 单元清单服务 / the DiscoveryService inventory', () => {
  it('插件模块经 ctx.plugin 装载：list 按 dir 排序、find 按名查找 / installed via ctx.plugin: list is sorted by dir, find looks up by name', async () => {
    const root = makeRoot();
    const apps = join(root, 'apps');
    mkdirSync(apps, { recursive: true });
    mkdirSync(join(apps, 'zeta'));
    writeFileSync(join(apps, 'zeta', 'package.json'), JSON.stringify({ name: '@x/zeta', description: 'z' }));
    mkdirSync(join(apps, 'alpha'));
    writeFileSync(join(apps, 'alpha', 'package.json'), JSON.stringify({ name: '@x/alpha', description: 'a' }));

    const service = await install(root);
    expect((await service.list()).map((unit) => unit.name)).toEqual(['@x/alpha', '@x/zeta']);
    expect((await service.find('@x/alpha'))?.dir).toBe('apps/alpha');
    expect(await service.find('nope')).toBeUndefined();
    expect(service.root).toBe(root);
  });

  it('配置 maxDepth 限制扫描深度 / the maxDepth config caps the scan depth', async () => {
    const root = makeRoot();
    const deep = join(root, 'apps', 'outer', 'inner');
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(deep, 'package.json'), JSON.stringify({ name: '@x/deep', description: '' }));

    // maxDepth 0 只看 scan 根自身：apps/outer（深度 1）不再进入
    // With maxDepth 0 only the scan root itself is examined: apps/outer (depth 1) is not entered
    const service = await install(root, { maxDepth: 0 });
    expect(await service.list()).toEqual([]);
  });

  it('配置 skip 在内置名单之外追加目录名 / the skip config adds directory names beyond the built-in list', async () => {
    const root = makeRoot();
    const hidden = join(root, 'apps', 'secret');
    mkdirSync(hidden, { recursive: true });
    writeFileSync(join(hidden, 'package.json'), JSON.stringify({ name: '@x/secret', description: '' }));
    const kept = join(root, 'apps', 'kept');
    mkdirSync(kept, { recursive: true });
    writeFileSync(join(kept, 'package.json'), JSON.stringify({ name: '@x/kept', description: '' }));

    const service = await install(root, { skip: ['secret'] });
    expect((await service.list()).map((unit) => unit.name)).toEqual(['@x/kept']);
  });
});
