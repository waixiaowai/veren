/**
 * 递归扫描测试：npm 优先、深度上限、跳过名单与坏清单隔离。
 *
 * Recursive-scan tests: npm precedence, the depth cap, skip lists and
 * bad-manifest isolation.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, afterEach, describe, expect, it } from 'vitest';
import type { FileSystem } from '@deepseek-ai/dsh-fs';
import { MAX_SCAN_DEPTH, discoverUnits } from '../src/discovery';
import { captureStderr, cleanRoots, configFor, createLocalFs, makeRoot } from './helpers';

/** 注入的 ctx.fs 文件系统服务（dsh-fs 本地后端）/ the injected ctx.fs filesystem service (the dsh-fs local backend) */
let fs: FileSystem;

beforeAll(() => {
  fs = createLocalFs();
});

afterEach(() => {
  cleanRoots();
});

describe('discoverUnits', () => {
  it('递归发现单元：npm 优先、跳过 node_modules、输出按 dir 排序 / recursive discovery: npm wins, node_modules skipped, output sorted', async () => {
    const root = makeRoot();
    const npmAndCargo = join(root, 'apps', 'both');
    mkdirSync(npmAndCargo, { recursive: true });
    writeFileSync(join(npmAndCargo, 'package.json'), JSON.stringify({ name: '@x/both', description: '' }));
    writeFileSync(join(npmAndCargo, 'Cargo.toml'), '[package]\nname = "x-both-cargo"\n');

    const cargoOnly = join(root, 'cargos', 'core');
    mkdirSync(cargoOnly, { recursive: true });
    writeFileSync(join(cargoOnly, 'Cargo.toml'), '[package]\nname = "x-core"\ndescription = "core"\n');

    // 命中单元后不再下钻：单元内的嵌套清单不会被重复发现 / no descent into a matched unit
    const inner = join(npmAndCargo, 'inner');
    mkdirSync(inner);
    writeFileSync(join(inner, 'package.json'), JSON.stringify({ name: '@x/both-inner' }));

    const skipped = join(root, 'apps', 'node_modules', 'junk');
    mkdirSync(skipped, { recursive: true });
    writeFileSync(join(skipped, 'package.json'), JSON.stringify({ name: '@x/junk' }));

    const units = await discoverUnits(fs, root, configFor(root, 'apps', 'cargos'));
    expect(units).toEqual([
      { name: '@x/both', description: '', dir: 'apps/both' },
      { name: 'x-core', description: 'core', dir: 'cargos/core' },
    ]);
  });

  it('超过扫描深度上限的单元被忽略 / ignores units below the scan depth cap', async () => {
    const root = makeRoot();
    // 深度超过上限：scan 根 apps(0) → d0(1) → … → d5(6)，d4 起不再进入
    // Depth beyond the cap: scan root apps(0) → d0(1) → … → d5(6); entering stops at d4
    const levels = Array.from({ length: MAX_SCAN_DEPTH + 2 }, (_, i) => `d${i}`);
    const deep = join(root, 'apps', ...levels);
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(deep, 'package.json'), JSON.stringify({ name: '@x/too-deep' }));

    const shallow = join(root, 'apps', 'near');
    mkdirSync(shallow, { recursive: true });
    writeFileSync(join(shallow, 'package.json'), JSON.stringify({ name: '@x/near' }));

    const units = await discoverUnits(fs, root, configFor(root, 'apps'));
    expect(units).toEqual([{ name: '@x/near', description: '', dir: 'apps/near' }]);
  });

  it('扫描中遇到坏清单只跳过该目录，其余单元照常发现 / a bad manifest only skips its own directory; other units are still found', async () => {
    const root = makeRoot();
    const broken = join(root, 'apps', 'broken');
    mkdirSync(broken, { recursive: true });
    writeFileSync(join(broken, 'package.json'), '{ oops');

    const good = join(root, 'apps', 'good');
    mkdirSync(good, { recursive: true });
    writeFileSync(join(good, 'package.json'), JSON.stringify({ name: '@x/good', description: 'fine' }));

    // 静默告警输出，保持测试输出干净 / silence the warning output to keep test logs clean
    let units: Awaited<ReturnType<typeof discoverUnits>>;
    await captureStderr(async () => {
      units = await discoverUnits(fs, root, configFor(root, 'apps'));
    });
    expect(units).toEqual([{ name: '@x/good', description: 'fine', dir: 'apps/good' }]);
  });
});
