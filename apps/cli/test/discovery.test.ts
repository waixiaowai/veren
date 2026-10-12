import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_SCAN_DEPTH, discoverUnits, parseCargoPackageFields, readCargoUnit, readNpmUnit } from '../src/discovery';
import type { Config } from '../src/config';

/**
 * 每个用例独立的临时工作区，afterEach 统一删除。
 * A per-test temporary workspace, removed together in afterEach.
 */
let root: string;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = '';
});

/** 创建临时工作区 / create a temporary workspace */
function makeRoot(): string {
  root = mkdtempSync(join(tmpdir(), 'veren-cli-discovery-'));
  return root;
}

/** 以 root 为项目根构建 Config / build a Config rooted at root */
function configFor(...names: string[]): Config {
  return { scanRoots: names.map((name) => join(root, name)) };
}

describe('parseCargoPackageFields', () => {
  it('提取 [package] 段的 name 与 description / extracts name and description from [package]', () => {
    const text = ['[package]', 'name = "veren-core"', 'description = "Core Veren library."', '', '[dependencies]'].join('\n');
    expect(parseCargoPackageFields(text)).toEqual({ name: 'veren-core', description: 'Core Veren library.' });
  });

  it('容忍行尾注释与转义引号 / tolerates trailing comments and escaped quotes', () => {
    const text = '[package]\nname = "a" # trailing comment\ndescription = "say \\"hi\\" now"\n';
    expect(parseCargoPackageFields(text)).toEqual({ name: 'a', description: 'say "hi" now' });
  });

  it('忽略 [package] 之外的同名字段 / ignores same-named fields outside [package]', () => {
    const text = '[dependencies]\nname = "wrong"\n\n[package]\nname = "right"\n';
    expect(parseCargoPackageFields(text).name).toBe('right');
  });
});

describe('readNpmUnit / readCargoUnit', () => {
  it('读取 npm 单元并归一化 dir 分隔符 / reads an npm unit with normalized dir separators', () => {
    const dir = join(makeRoot(), 'pkg-a');
    mkdirSync(dir);
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@x/pkg-a', description: 'demo' }));
    expect(readNpmUnit(dir, root)).toEqual({ name: '@x/pkg-a', description: 'demo', dir: 'pkg-a' });
  });

  it('package.json 缺 name 时视为非单元 / treats a package.json without a name as a non-unit', () => {
    const dir = join(makeRoot(), 'anon');
    mkdirSync(dir);
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '0.0.0' }));
    expect(readNpmUnit(dir, root)).toBeNull();
  });

  it('读取 Rust 单元 / reads a Rust unit', () => {
    const dir = join(makeRoot(), 'apps', 'web');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname = "x-web"\ndescription = "web app"\n');
    expect(readCargoUnit(dir, root)).toEqual({ name: 'x-web', description: 'web app', dir: 'apps/web' });
  });

  it('没有清单文件时返回 null / returns null without any manifest', () => {
    const dir = join(makeRoot(), 'empty');
    mkdirSync(dir);
    expect(readNpmUnit(dir, root)).toBeNull();
    expect(readCargoUnit(dir, root)).toBeNull();
  });
});

describe('discoverUnits', () => {
  it('递归发现单元：npm 优先、跳过 node_modules、输出按 dir 排序 / recursive discovery: npm wins, node_modules skipped, output sorted', () => {
    makeRoot();
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

    const units = discoverUnits(root, configFor('apps', 'cargos'));
    expect(units).toEqual([
      { name: '@x/both', description: '', dir: 'apps/both' },
      { name: 'x-core', description: 'core', dir: 'cargos/core' },
    ]);
  });

  it('超过扫描深度上限的单元被忽略 / ignores units below the scan depth cap', () => {
    makeRoot();
    // 深度超过上限：scan 根 apps(0) → d0(1) → … → d5(6)，d4 起不再进入
    // Depth beyond the cap: scan root apps(0) → d0(1) → … → d5(6); entering stops at d4
    const levels = Array.from({ length: MAX_SCAN_DEPTH + 2 }, (_, i) => `d${i}`);
    const deep = join(root, 'apps', ...levels);
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(deep, 'package.json'), JSON.stringify({ name: '@x/too-deep' }));

    const shallow = join(root, 'apps', 'near');
    mkdirSync(shallow, { recursive: true });
    writeFileSync(join(shallow, 'package.json'), JSON.stringify({ name: '@x/near' }));

    const units = discoverUnits(root, configFor('apps'));
    expect(units).toEqual([{ name: '@x/near', description: '', dir: 'apps/near' }]);
  });
});
