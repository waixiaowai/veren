import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import type { Fiber } from '@deepseek-ai/cordis';
import LocalFileSystem from '@deepseek-ai/dsh-fs-local';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MAX_SCAN_DEPTH, discoverUnits, parseCargoPackageFields, readCargoUnit, readNpmUnit } from '../src/discovery';
import type { ScanConfig } from '../src/discovery';
import { Discovery } from '../src/service';
import * as DiscoveryPlugin from '../src/index';
import { Project } from '@veren/commander-project';
import type { FileSystem } from '@deepseek-ai/dsh-fs';

/** 注入的 ctx.fs 文件系统服务（dsh-fs 本地后端）/ the injected ctx.fs filesystem service (the dsh-fs local backend) */
let fs: FileSystem;

beforeAll(() => {
  fs = new LocalFileSystem(new Context(), LocalFileSystem.Config({}));
});

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
  root = mkdtempSync(join(tmpdir(), 'veren-commander-discovery-'));
  return root;
}

/** 以 root 为项目根构建 ScanConfig / build a ScanConfig rooted at root */
function configFor(...names: string[]): ScanConfig {
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

  it('支持单引号字面量串：原样保留，不处理转义 / supports single-quoted literal strings verbatim, without escape processing', () => {
    const text = "[package]\nname = 'x-literal'\ndescription = 'keep \\n as-is' # comment\n";
    expect(parseCargoPackageFields(text)).toEqual({ name: 'x-literal', description: 'keep \\n as-is' });
  });

  it('忽略 [package] 之外的同名字段 / ignores same-named fields outside [package]', () => {
    const text = '[dependencies]\nname = "wrong"\n\n[package]\nname = "right"\n';
    expect(parseCargoPackageFields(text).name).toBe('right');
  });
});

describe('readNpmUnit / readCargoUnit', () => {
  it('读取 npm 单元并归一化 dir 分隔符 / reads an npm unit with normalized dir separators', async () => {
    const dir = join(makeRoot(), 'pkg-a');
    mkdirSync(dir);
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@x/pkg-a', description: 'demo' }));
    expect(await readNpmUnit(fs, dir, root)).toEqual({ name: '@x/pkg-a', description: 'demo', dir: 'pkg-a' });
  });

  it('package.json 缺 name 时视为非单元 / treats a package.json without a name as a non-unit', async () => {
    const dir = join(makeRoot(), 'anon');
    mkdirSync(dir);
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '0.0.0' }));
    expect(await readNpmUnit(fs, dir, root)).toBeNull();
  });

  it('读取 Rust 单元 / reads a Rust unit', async () => {
    const dir = join(makeRoot(), 'apps', 'web');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname = "x-web"\ndescription = "web app"\n');
    expect(await readCargoUnit(fs, dir, root)).toEqual({ name: 'x-web', description: 'web app', dir: 'apps/web' });
  });

  it('没有清单文件时返回 null / returns null without any manifest', async () => {
    const dir = join(makeRoot(), 'empty');
    mkdirSync(dir);
    expect(await readNpmUnit(fs, dir, root)).toBeNull();
    expect(await readCargoUnit(fs, dir, root)).toBeNull();
  });

  it('package.json 损坏时向 stderr 告警并返回 null / warns on stderr and returns null for a corrupted package.json', async () => {
    const dir = join(makeRoot(), 'broken');
    mkdirSync(dir);
    writeFileSync(join(dir, 'package.json'), '{ not json');
    const warnings: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: unknown) => {
      warnings.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      expect(await readNpmUnit(fs, dir, root)).toBeNull();
    } finally {
      process.stderr.write = original;
    }
    expect(warnings.join('')).toContain('unparseable manifest');
  });
});

describe('discoverUnits', () => {
  it('递归发现单元：npm 优先、跳过 node_modules、输出按 dir 排序 / recursive discovery: npm wins, node_modules skipped, output sorted', async () => {
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

    const units = await discoverUnits(fs, root, configFor('apps', 'cargos'));
    expect(units).toEqual([
      { name: '@x/both', description: '', dir: 'apps/both' },
      { name: 'x-core', description: 'core', dir: 'cargos/core' },
    ]);
  });

  it('超过扫描深度上限的单元被忽略 / ignores units below the scan depth cap', async () => {
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

    const units = await discoverUnits(fs, root, configFor('apps'));
    expect(units).toEqual([{ name: '@x/near', description: '', dir: 'apps/near' }]);
  });

  it('扫描中遇到坏清单只跳过该目录，其余单元照常发现 / a bad manifest only skips its own directory; other units are still found', async () => {
    makeRoot();
    const broken = join(root, 'apps', 'broken');
    mkdirSync(broken, { recursive: true });
    writeFileSync(join(broken, 'package.json'), '{ oops');

    const good = join(root, 'apps', 'good');
    mkdirSync(good, { recursive: true });
    writeFileSync(join(good, 'package.json'), JSON.stringify({ name: '@x/good', description: 'fine' }));

    // 静默告警输出，保持测试输出干净 / silence the warning output to keep test logs clean
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = () => true;
    let units: Awaited<ReturnType<typeof discoverUnits>>;
    try {
      units = await discoverUnits(fs, root, configFor('apps'));
    } finally {
      process.stderr.write = original;
    }
    expect(units).toEqual([{ name: '@x/good', description: 'fine', dir: 'apps/good' }]);
  });
});

/**
 * DiscoveryService 插件用例：先提供 Project 服务与 ctx.fs 后端，
 * 再经 ctx.plugin 装载插件模块（Config schema 自动校验补全），
 * fiber 统一收进 fibers 清理。
 *
 * The DiscoveryService plugin cases: provide the Project service and the
 * ctx.fs backend first, then install the plugin module via ctx.plugin (its
 * Config schema is validated and default-filled automatically); fibers are
 * collected into fibers for cleanup.
 */
const fibers: Array<Fiber> = [];

afterEach(async () => {
  await Promise.allSettled(fibers.map((fiber) => fiber.dispose()));
  fibers.length = 0;
});

/** 提供依赖服务并装载插件，返回服务 / provide the dependencies, install the plugin and return the service */
async function install(config?: Parameters<typeof DiscoveryPlugin.apply>[1]) {
  const ctx = new Context();
  ctx.provide(Project, { root, config: { scanRoots: configFor('apps', 'cargos').scanRoots } });
  new LocalFileSystem(ctx, LocalFileSystem.Config({})); // 注册 ctx.fs / registers ctx.fs
  const fiber = ctx.plugin(DiscoveryPlugin, config);
  await fiber;
  fibers.push(fiber);
  return ctx.get(Discovery)!;
}

describe('DiscoveryService 单元清单服务 / the DiscoveryService inventory', () => {
  it('插件模块经 ctx.plugin 装载：list 按 dir 排序、find 按名查找 / installed via ctx.plugin: list is sorted by dir, find looks up by name', async () => {
    makeRoot();
    const apps = join(root, 'apps');
    mkdirSync(apps, { recursive: true });
    mkdirSync(join(apps, 'zeta'));
    writeFileSync(join(apps, 'zeta', 'package.json'), JSON.stringify({ name: '@x/zeta', description: 'z' }));
    mkdirSync(join(apps, 'alpha'));
    writeFileSync(join(apps, 'alpha', 'package.json'), JSON.stringify({ name: '@x/alpha', description: 'a' }));

    const service = await install();
    expect((await service.list()).map((unit) => unit.name)).toEqual(['@x/alpha', '@x/zeta']);
    expect((await service.find('@x/alpha'))?.dir).toBe('apps/alpha');
    expect(await service.find('nope')).toBeUndefined();
    expect(service.root).toBe(root);
  });

  it('配置 maxDepth 限制扫描深度 / the maxDepth config caps the scan depth', async () => {
    makeRoot();
    const deep = join(root, 'apps', 'outer', 'inner');
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(deep, 'package.json'), JSON.stringify({ name: '@x/deep', description: '' }));

    // maxDepth 0 只看 scan 根自身：apps/outer（深度 1）不再进入
    // With maxDepth 0 only the scan root itself is examined: apps/outer (depth 1) is not entered
    const service = await install({ maxDepth: 0 });
    expect(await service.list()).toEqual([]);
  });

  it('配置 skip 在内置名单之外追加目录名 / the skip config adds directory names beyond the built-in list', async () => {
    makeRoot();
    const hidden = join(root, 'apps', 'secret');
    mkdirSync(hidden, { recursive: true });
    writeFileSync(join(hidden, 'package.json'), JSON.stringify({ name: '@x/secret', description: '' }));
    const kept = join(root, 'apps', 'kept');
    mkdirSync(kept, { recursive: true });
    writeFileSync(join(kept, 'package.json'), JSON.stringify({ name: '@x/kept', description: '' }));

    const service = await install({ skip: ['secret'] });
    expect((await service.list()).map((unit) => unit.name)).toEqual(['@x/kept']);
  });
});
