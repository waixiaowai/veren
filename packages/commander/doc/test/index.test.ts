import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import type { Fiber } from '@deepseek-ai/cordis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as RegistryPlugin from '@veren/commander-core';
import { Commands } from '@veren/commander-core';
import { DiscoveryService } from '@veren/commander-discovery';
import LocalFileSystem from '@deepseek-ai/dsh-fs-local';
import * as DocPlugin from '../src/index';

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
  root = mkdtempSync(join(tmpdir(), 'veren-commander-doc-'));
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

/** 夹具：alpha（npm，双语文档）、beta（Rust，仅中文）、gamma（npm，无文档）/ fixture: alpha (npm, bilingual), beta (Rust, Chinese only), gamma (npm, no docs) */
function makeUnits(): string {
  const units = join(root, 'units');
  const alpha = join(units, 'alpha');
  mkdirSync(alpha, { recursive: true });
  writeFileSync(join(alpha, 'package.json'), JSON.stringify({ name: '@t/alpha', description: 'alpha unit' }));
  writeFileSync(join(alpha, 'README.md'), 'alpha-en-doc\n');
  writeFileSync(join(alpha, 'README.cn.md'), 'alpha-cn-doc\n');
  const beta = join(units, 'beta');
  mkdirSync(beta, { recursive: true });
  writeFileSync(join(beta, 'Cargo.toml'), '[package]\nname = "beta"\ndescription = "beta unit"\n');
  writeFileSync(join(beta, 'README.cn.md'), 'beta-cn-doc\n');
  const gamma = join(units, 'gamma');
  mkdirSync(gamma, { recursive: true });
  writeFileSync(join(gamma, 'package.json'), JSON.stringify({ name: '@t/gamma', description: 'gamma unit' }));
  return units;
}

/** 注册表 + ctx.fs 后端 + Discovery 服务，再装载 doc 插件 / registry + ctx.fs backend + Discovery service, then install doc */
const fs = new LocalFileSystem(new Context(), LocalFileSystem.Config({}));

async function install(config?: Parameters<typeof DocPlugin.apply>[1]) {
  new DiscoveryService(ctx, { root, config: { scanRoots: [join(root, 'units')] } }, fs);
  const registryFiber = ctx.plugin(RegistryPlugin);
  await registryFiber;
  fibers.push(registryFiber);
  const fiber = ctx.plugin(DocPlugin, config);
  await fiber;
  fibers.push(fiber);
}

/** 执行 doc 命令并返回全部 stdout 输出 / run the doc command and return everything written to stdout */
async function runDoc(args: string[]): Promise<string> {
  stdoutWrites.length = 0;
  await ctx.get(Commands)!.get('doc')!.run(args);
  return stdoutWrites.join('');
}

describe('doc 命令插件 / the doc command plugin', () => {
  beforeEach(() => {
    makeUnits();
  });

  it('默认输出 README.md 原文 / prints README.md verbatim by default', async () => {
    await install();
    expect(await runDoc(['@t/alpha'])).toBe('alpha-en-doc\n');
  });

  it('--cn 优先中文 / --cn prefers Chinese', async () => {
    await install();
    expect(await runDoc(['@t/alpha', '--cn'])).toBe('alpha-cn-doc\n');
  });

  it('配置 cnFlags 可替换缺省标志 / the cnFlags config replaces the default flags', async () => {
    await install({ cnFlags: ['--zh'] });
    expect(await runDoc(['@t/alpha', '--zh'])).toBe('alpha-cn-doc\n');
    // 缺省标志不再是中文触发器，按普通参数处理，输出英文 README
    // the default flags no longer trigger Chinese: they pass through as plain args and the English README prints
    expect(await runDoc(['@t/alpha', '--cn'])).toBe('alpha-en-doc\n');
  });

  it('首选语言缺失时回退另一语言 / falls back when the preferred language is missing', async () => {
    // beta 只有中文文档，英文优先时回退中文 / beta has Chinese only; English falls back to Chinese
    await install();
    expect(await runDoc(['beta'])).toBe('beta-cn-doc\n');
  });

  it('缺单元名时提示用法 / asks for usage when the unit name is missing', async () => {
    await install();
    await expect(runDoc(['--cn'])).rejects.toThrowError(/usage/);
  });

  it('未知单元时报错并列出可用名 / errors on an unknown unit, listing the available names', async () => {
    await install();
    await expect(runDoc(['nope'])).rejects.toThrowError(/@t\/alpha/);
  });

  it('单元没有任何 README 时报错 / errors when the unit has no README at all', async () => {
    await install();
    await expect(runDoc(['@t/gamma'])).rejects.toThrowError(/README/);
  });

  it('命令插件卸载后 doc 从注册表消失 / doc disappears from the registry when its plugin unloads', async () => {
    await install();
    const docFiber = fibers[fibers.length - 1]!;
    await docFiber.dispose();
    expect(ctx.get(Commands)!.get('doc')).toBeUndefined();
  });
});
