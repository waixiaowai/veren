import { Context } from '@deepseek-ai/cordis';
import type { Fiber } from '@deepseek-ai/cordis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as RegistryPlugin from '@veren/commander-core';
import { Commands } from '@veren/commander-core';
import * as HelpPlugin from '../src/index';

/**
 * 每个用例使用独立的 cordis Context；插件模块（index 命名空间）经
 * ctx.plugin 装载，Config schema 自动校验补全；fiber 的 dispose 统一收进
 * fibers，在 afterEach 中清理。
 *
 * Every test builds its own cordis Context. The plugin modules (the index
 * namespaces) install via ctx.plugin with their Config schemas validated and
 * default-filled automatically; fibers are disposed together in afterEach.
 */
let ctx: Context;
let fibers: Array<Fiber> = [];
const stdoutWrites: string[] = [];
let stdoutSpy: ReturnType<typeof vi.spyOn> | undefined;

beforeEach(() => {
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
});

/** 装载注册表宿主、注册示例命令、装载 help 插件 / install the registry host, a sample command, then the help plugin */
async function install(config?: Parameters<typeof HelpPlugin.apply>[1]) {
  const registryFiber = ctx.plugin(RegistryPlugin);
  await registryFiber;
  fibers.push(registryFiber);
  ctx.get(Commands)!.register({ name: 'fake', usage: 'fake <x>', summary: '示例 / sample', run: () => {} });
  const fiber = ctx.plugin(HelpPlugin, config);
  await fiber;
  fibers.push(fiber);
}

describe('help 命令插件 / the help command plugin', () => {
  it('用法列表由已注册命令生成 / the usage list is generated from registered commands', async () => {
    await install();
    stdoutWrites.length = 0;
    await ctx.get(Commands)!.get('help')!.run([]);
    const output = stdoutWrites.join('');
    expect(output).toContain('pnpm cli fake <x>');
    expect(output).toContain('示例 / sample');
    expect(output).toContain('pnpm cli help');
  });

  it('配置 program 替换用法行程序名 / the program config replaces the program name on usage rows', async () => {
    await install({ program: 'mycli' });
    stdoutWrites.length = 0;
    await ctx.get(Commands)!.get('help')!.run([]);
    const output = stdoutWrites.join('');
    expect(output).toContain('mycli fake <x>');
    expect(output).not.toContain('pnpm cli fake');
  });

  it('命令插件卸载后 help 从注册表消失 / help disappears from the registry when its plugin unloads', async () => {
    await install();
    const helpFiber = fibers[fibers.length - 1]!;
    await helpFiber.dispose();
    expect(ctx.get(Commands)!.get('help')).toBeUndefined();
  });
});
