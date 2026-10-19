/**
 * startup 插件测试：用真实 Cordis Context 提供 argv 与 exit，验证分发和退出码。
 *
 * Startup plugin tests: a real Cordis Context supplies argv and exit, proving
 * dispatch and the exit code.
 */

import { Context } from '@deepseek-ai/cordis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandService, Commands } from '@veren/commander-core';
import * as Startup from '../src/index';

/** 带 provide 的结构视图（测试不引入 dsh-cmdline 的 declaration merge）/ structural view with provide (the test does not pull dsh-cmdline's declaration merge) */
type TestContext = Context & { provide(name: string, value: unknown): void };

let ctx: Context;
let exits: number[];

beforeEach(() => {
  ctx = new Context();
  exits = [];
  new CommandService(ctx, { helpFlags: [] });
  (ctx as TestContext).provide('appExit', (code: number) => { exits.push(code); });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** 注册一个测试命令 / register one test command */
function registerDemo(run: () => void): void {
  ctx.get(Commands)!.register({
    name: 'demo',
    usage: 'demo',
    summary: 'demo command',
    run,
  });
}

describe('commander startup / commander profile 启动插件', () => {
  it('分发 argv 并请求退出码 0 / dispatches argv and requests exit code 0', async () => {
    let called = 0;
    registerDemo(() => { called += 1; });
    (ctx as TestContext).provide('cmdlineArgs', { get: () => ['demo'] });
    await ctx.plugin(Startup);

    await vi.waitFor(() => { expect(exits).toEqual([0]); });
    expect(called).toBe(1);
  });

  it('命令失败时写 stderr 并请求退出码 1 / writes stderr and requests exit code 1 on failure', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    registerDemo(() => { throw new Error('boom'); });
    (ctx as TestContext).provide('cmdlineArgs', { get: () => ['demo'] });
    await ctx.plugin(Startup);

    await vi.waitFor(() => { expect(exits).toEqual([1]); });
    expect(stderr).toHaveBeenCalledWith('cli: boom\n');
  });

  it('等待 loader 完成后再分发 / waits for the loader before dispatching', async () => {
    let ready = false;
    registerDemo(() => { expect(ready).toBe(true); });
    (ctx as TestContext).provide('loader', {
      await: async () => { ready = true; },
    });
    (ctx as TestContext).provide('cmdlineArgs', { get: () => ['demo'] });
    await ctx.plugin(Startup);

    await vi.waitFor(() => { expect(exits).toEqual([0]); });
  });

  it('无 appExit 时退回 process.exitCode / falls back to process.exitCode without appExit', async () => {
    ctx = new Context();
    new CommandService(ctx, { helpFlags: [] });
    registerDemo(() => {});
    (ctx as TestContext).provide('cmdlineArgs', { get: () => ['demo'] });
    await ctx.plugin(Startup);

    await vi.waitFor(() => { expect(process.exitCode).toBe(0); });
  });
});
