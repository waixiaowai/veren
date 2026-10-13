import { Context } from '@deepseek-ai/cordis';
import type { Fiber } from '@deepseek-ai/cordis';
import { afterEach, describe, expect, it } from 'vitest';
import * as RegistryPlugin from '../src/index';
import { Commands } from '../src/commands';

/**
 * 每个用例使用独立的 cordis Context；插件模块（index 命名空间）经
 * ctx.plugin 装载，Config schema 自动校验补全；fiber 统一收进 fibers，
 * 在 afterEach 中清理，避免插件与服务跨用例泄漏。
 *
 * Every test builds its own cordis Context. The plugin module (the index
 * namespace) installs via ctx.plugin with its Config schema validated and
 * default-filled automatically; fibers are disposed together in afterEach so
 * no plugin or service leaks across cases.
 */
const fibers: Array<Fiber> = [];

afterEach(async () => {
  await Promise.allSettled(fibers.map((fiber) => fiber.dispose()));
  fibers.length = 0;
});

/** 装载注册表插件并返回上下文与服务 / install the registry plugin and return ctx + service */
async function setup(config?: Parameters<typeof RegistryPlugin.apply>[1]) {
  const ctx = new Context();
  const fiber = ctx.plugin(RegistryPlugin, config);
  await fiber;
  fibers.push(fiber);
  return { ctx, service: ctx.get(Commands)! };
}

describe('commands 命令注册表 / the command registry', () => {
  it('模块即插件：apply 把注册表提供到上下文 / the module is a plugin: apply provides the registry service', async () => {
    const { service } = await setup();
    // ctx.get 对带 tracker 的服务每次返回新的 traceable 包装，代理间 === 为
    // false，深度探测（instanceof 等）还会触发上下文代理限制，因此只对服务
    // 自身的真实属性与方法断言。
    // ctx.get wraps tracker-carrying services in a fresh traceable proxy per
    // call: proxies are never ===, and deep probes (instanceof etc.) trip the
    // context proxy limits — assert on the service's own properties instead.
    expect(service.name).toBe('verenCliCommands');
    expect(service.list).toBeTypeOf('function');
    expect(service.register).toBeTypeOf('function');
    expect(service.dispatch).toBeTypeOf('function');
  });

  it('未传配置时 schema 缺省值生效 / schema defaults apply when no config is passed', async () => {
    const { service } = await setup();
    expect(service.config.helpFlags).toEqual(['--help', '-h']);
  });

  it('传入配置覆盖缺省值 / a passed config overrides the defaults', async () => {
    const { service } = await setup({ helpFlags: ['/h'] });
    expect(service.config.helpFlags).toEqual(['/h']);
  });

  it('register 后可按名查找，list 按名称排序 / register makes commands findable; list is sorted by name', async () => {
    const { service } = await setup();
    service.register({ name: 'doc', usage: 'doc <name>', summary: 's', run: () => {} });
    service.register({ name: 'list', usage: 'list', summary: 's', run: () => {} });
    expect(service.get('list')?.usage).toBe('list');
    expect(service.get('nope')).toBeUndefined();
    expect(service.list().map((command) => command.name)).toEqual(['doc', 'list']);
  });

  it('重名注册立即报错 / a duplicate name throws immediately', async () => {
    const { service } = await setup();
    service.register({ name: 'list', usage: 'list', summary: 's', run: () => {} });
    expect(() => service.register({ name: 'list', usage: 'list', summary: 's', run: () => {} })).toThrowError(
      /already registered/,
    );
  });

  it('register 返回 disposer，调用后命令注销 / register returns a disposer that unregisters the command', async () => {
    const { service } = await setup();
    const dispose = service.register({ name: 'list', usage: 'list', summary: 's', run: () => {} });
    dispose();
    expect(service.get('list')).toBeUndefined();
  });
});

describe('service.dispatch 通用分发 / the generic dispatcher', () => {
  it('路由到命令并透传剩余参数 / routes to the command and forwards the remaining args', async () => {
    const { service } = await setup();
    const seen: string[][] = [];
    service.register({ name: 'fake', usage: 'fake', summary: 's', run: (args) => void seen.push([...args]) });
    await service.dispatch(['fake', 'a', 'b']);
    expect(seen).toEqual([['a', 'b']]);
  });

  it('无参数与缺省 helpFlags 都路由到 help / no arguments and the default helpFlags both route to help', async () => {
    const { service } = await setup();
    const calls: number[] = [];
    service.register({ name: 'help', usage: 'help', summary: 's', run: () => void calls.push(1) });
    await service.dispatch([]);
    await service.dispatch(['--help']);
    await service.dispatch(['-h']);
    expect(calls).toEqual([1, 1, 1]);
  });

  it('配置的 helpFlags 由 dispatch 生效 / the configured helpFlags drive dispatch', async () => {
    const { service } = await setup({ helpFlags: ['/h'] });
    const calls: number[] = [];
    service.register({ name: 'help', usage: 'help', summary: 's', run: () => void calls.push(1) });
    await service.dispatch(['/h']);
    expect(calls).toEqual([1]);
    // 缺省标志不再是 help 触发器，按未知命令处理 / the default flags no longer trigger help and fall through as unknown
    await expect(service.dispatch(['--help'])).rejects.toThrowError(/unknown command "--help"/s);
  });

  it('未知命令报错并列出全部可用命令 / an unknown command throws with every available name', async () => {
    const { service } = await setup();
    service.register({ name: 'list', usage: 'list', summary: 's', run: () => {} });
    await expect(service.dispatch(['nope'])).rejects.toThrowError(/unknown command "nope".*list/s);
  });
});
