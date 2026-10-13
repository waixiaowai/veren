import { Context } from '@deepseek-ai/cordis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Commands } from '@veren/commander-core';
import { getOrThrow } from '@veren/core';
import { createRuntime } from '../src/runtime';

/**
 * 组装层集成测试：装载 apps/cli 的真实插件清单（本测试位于 apps/cli，
 * findProjectRoot 向上命中仓库根的 .veren.yaml），stdout 用 spy 捕获，
 * 保持用例断言封闭。分发经注册表服务的 dispatch 方法进行。
 *
 * Integration tests for the assembly layer: the real apps/cli plugin manifest
 * is installed (this test lives in apps/cli, so findProjectRoot walks up to
 * the repo root's .veren.yaml) and stdout is captured via a spy. Dispatch runs
 * through the registry service's dispatch method.
 */
let ctx: Context;
const stdoutWrites: string[] = [];
let stdoutSpy: ReturnType<typeof vi.spyOn> | undefined;

beforeEach(() => {
  stdoutWrites.length = 0;
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdoutWrites.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  stdoutSpy?.mockRestore();
});

/** 装载真实插件清单并取出分发器 / install the real plugin manifest and take the dispatcher */
async function setup() {
  ctx = await createRuntime();
  return getOrThrow(ctx, Commands);
}

describe('组装层插件清单 / the assembly plugin manifest', () => {
  it('未知命令报错并列出全部可用命令 / an unknown command throws with every available name', async () => {
    const dispatcher = await setup();
    await expect(dispatcher.dispatch(['nope'])).rejects.toThrowError(/unknown command "nope"/);
    await expect(dispatcher.dispatch(['nope'])).rejects.toThrowError(/list/);
  });

  it('无参数路由到 help / no arguments routes to help', async () => {
    const dispatcher = await setup();
    await dispatcher.dispatch([]);
    expect(stdoutWrites.join('')).toContain('pnpm cli list');
    expect(stdoutWrites.join('')).toContain('用法 / usage');
  });

  it('--help 别名同样路由到 help / the --help alias routes to help too', async () => {
    const dispatcher = await setup();
    await dispatcher.dispatch(['--help']);
    expect(stdoutWrites.join('')).toContain('pnpm cli doc <name> [--cn]');
  });

  it('list 命令经注册表执行并输出可解析 JSON / the list command runs through the registry and prints parseable JSON', async () => {
    const dispatcher = await setup();
    await dispatcher.dispatch(['list']);
    const units = JSON.parse(stdoutWrites.join('')) as Array<{ name: string }>;
    expect(units.length).toBeGreaterThan(0);
    expect(units.some((unit) => unit.name === '@veren/cli')).toBe(true);
  });
});
