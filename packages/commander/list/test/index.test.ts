import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import type { Fiber } from '@deepseek-ai/cordis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as RegistryPlugin from '@veren/commander-core';
import { Commands } from '@veren/commander-core';
import { DiscoveryService } from '@veren/commander-discovery';
import { name as FsToken } from '@veren/node-fs';
import { createNodeFs } from '@veren/node-fs/service';
import { name as PathToken } from '@veren/node-path';
import { createNodePath } from '@veren/node-path/service';
import * as ListPlugin from '../src/index';
import { cmdList } from '../src/list';

/**
 * 命令插件经 ctx.plugin 模块装载（Config schema 自动校验补全）；Discovery
 * 服务用临时目录里的真实项目信息构造，先注册再装载命令插件（inject 依赖
 * 就绪后 fiber 才会激活），保证用例封闭。fiber 统一收进 fibers 清理。
 *
 * Command plugins install as modules via ctx.plugin (Config schema validated
 * and default-filled automatically); the Discovery service is built from real
 * project info over a temp tree and registered BEFORE the command plugin
 * loads (a fiber only activates once its inject dependencies exist), keeping
 * cases hermetic. Fibers are collected into fibers for cleanup.
 */
let root: string;
let ctx: Context;
let fibers: Array<Fiber> = [];
const stdoutWrites: string[] = [];
let stdoutSpy: ReturnType<typeof vi.spyOn> | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'veren-commander-list-'));
  ctx = new Context();
  fibers = [];
  stdoutWrites.length = 0;
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdoutWrites.push(String(chunk));
    return true;
  });
});

afterEach(async () => {
  stdoutSpy?.mockRestore();
  await Promise.allSettled(fibers.map((fiber) => fiber.dispose()));
  if (root) rmSync(root, { recursive: true, force: true });
});

/** 夹具：npm 单元 + Rust 单元 / fixture: one npm unit + one Rust unit */
function makeUnits(): string {
  const units = join(root, 'units');
  const alpha = join(units, 'alpha');
  mkdirSync(alpha, { recursive: true });
  writeFileSync(join(alpha, 'package.json'), JSON.stringify({ name: '@t/alpha', description: 'alpha unit' }));
  const beta = join(units, 'beta');
  mkdirSync(beta, { recursive: true });
  writeFileSync(join(beta, 'Cargo.toml'), '[package]\nname = "beta"\ndescription = "beta unit"\n');
  return units;
}

/** 注册表 + Discovery 服务，再装载 list 插件；Discovery 经注入的 fs/path 服务扫描 / registry + Discovery service, then install list; Discovery scans via the injected fs/path services */
const fs = createNodeFs({ encoding: 'utf8' });
const path = createNodePath({ platform: process.platform === 'win32' ? 'win32' : 'posix' });

async function install(config?: Parameters<typeof ListPlugin.apply>[1]) {
  ctx.provide(FsToken, fs);
  ctx.provide(PathToken, path);
  new DiscoveryService(ctx, { root, config: { scanRoots: [makeUnits()] } }, fs, path);
  const registryFiber = ctx.plugin(RegistryPlugin);
  await registryFiber;
  fibers.push(registryFiber);
  const fiber = ctx.plugin(ListPlugin, config);
  await fiber;
  fibers.push(fiber);
}

describe('list 命令插件 / the list command plugin', () => {
  it('JSON 输出全部单元，按 dir 排序 / prints every unit as JSON sorted by dir', async () => {
    await install();

    stdoutWrites.length = 0;
    await ctx.get(Commands)!.get('list')!.run([]);
    const parsed = JSON.parse(stdoutWrites.join('')) as Array<{ name: string; description: string; dir: string }>;
    expect(parsed.map((unit) => unit.name)).toEqual(['@t/alpha', 'beta']);
    expect(parsed[0]).toMatchObject({ name: '@t/alpha', description: 'alpha unit', dir: 'units/alpha' });
  });

  it('接受参数时报错 / rejects arguments', async () => {
    await expect(cmdList({ list: () => [] }, { indent: 2 }, ['x'])).rejects.toThrowError(/takes no arguments/);
  });

  it('配置 indent 替换 JSON 缩进 / the indent config replaces the JSON indentation', async () => {
    await install({ indent: 4 });
    stdoutWrites.length = 0;
    await ctx.get(Commands)!.get('list')!.run([]);
    // 缩进 4：首行数组括号后紧跟 4 个空格的缩进对象 / indent 4: four spaces before the first array element
    expect(stdoutWrites.join('').startsWith('[\n    {\n')).toBe(true);
  });

  it('命令插件卸载后命令从注册表消失 / commands disappear from the registry when their plugin unloads', async () => {
    await install();
    const listFiber = fibers[fibers.length - 1]!;
    await listFiber.dispose();
    expect(ctx.get(Commands)!.get('list')).toBeUndefined();
  });
});
