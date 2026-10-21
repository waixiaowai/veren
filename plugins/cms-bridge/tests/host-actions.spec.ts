import { describe, expect, it, vi } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import { Dispatcher } from '../src/dispatcher.js';
import { registerHostActions, HOST_ACTION_NAMES } from '../src/host-actions.js';
import type { ActionEntry } from '../src/protocol.js';

// 宿主控制器 action 桥测试:假控制器真实执行状态流转(记录调用并返回值),
// 走真 Dispatcher.dispatch 路径,不用 mock 返回值糊弄。
//
// 宿主上下文用真的 cordis Context:动作经 `ctx.get(name)` 取服务,所以替身必须
// 真的「在 ctx 上提供了服务」,而不是一个裸对象——否则测的是假装配,不是真装配。
// 服务类型仍取宿主真实面,只把「实现」放宽成 Partial(替身只实现被测到的方法)。

type Registered = Map<string, ActionEntry>;

/**
 * 在 ctx 上提供一个只实现部分方法的服务替身。`Partial` 放宽的是实现，不是类型。
 * Provides a service double implementing only the methods under test; the
 * `Partial` loosens the implementation, never the service type itself.
 *
 * @param ctx 宿主上下文 / the host context
 * @param name 服务名 / the service name
 * @param fake 部分实现 / a partial implementation
 */
function providePartial<K extends string & keyof Context>(
  ctx: Context,
  name: K,
  fake: Partial<NonNullable<Context[K]>>,
): void {
  ctx.provide(name, fake as NonNullable<Context[K]>);
}

function setup(host: (ctx: Context) => void = () => {}) {
  const ctx = new Context();
  host(ctx);
  const registered: Registered = new Map();
  const register = (action: string, entry: ActionEntry) => registered.set(action, entry);
  registerHostActions(ctx, register);
  const dispatcher = new Dispatcher({ commandTimeoutMs: 1_000 });
  for (const [action, entry] of registered) dispatcher.register(action, entry);
  return { registered, dispatch: (action: string, payload: unknown) => dispatcher.dispatch('test-id', action, payload) };
}

const workspaceView = {
  workspaceId: 'ws-1',
  path: '/tmp/proj',
  title: 'Proj',
  sessionIds: ['s-1'],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
};

describe('registerHostActions', () => {
  it('注册完整动作清单', () => {
    const { registered } = setup();
    for (const name of HOST_ACTION_NAMES) expect(registered.has(name)).toBe(true);
  });

  it('workspace.list 经 registry 投影 WorkspaceView 数组', async () => {
    const list = vi.fn(() => [
      { id: 'ws-1', path: '/tmp/proj', title: 'Proj', sessionIds: ['s-1'], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' },
    ]);
    const { dispatch } = setup((ctx) => providePartial(ctx, 'workspaceRegistry', { list }));
    const result = await dispatch('workspace.list', {});
    expect(result.ok).toBe(true);
    expect(list).toHaveBeenCalledOnce();
    expect(result.ok && result.result).toEqual({ workspaces: [workspaceView] });
  });

  it('workspace.create 透传请求到控制器', async () => {
    const create = vi.fn(async () => ({ workspace: workspaceView, created: true }));
    const { dispatch } = setup((ctx) => providePartial(ctx, 'workspaceController', { create }));
    const result = await dispatch('workspace.create', { path: '/tmp/proj' });
    expect(create).toHaveBeenCalledWith({ path: '/tmp/proj' });
    expect(result.ok).toBe(true);
  });

  it('workspace.rename 缺 title:校验拒绝且不触控制器', async () => {
    const rename = vi.fn();
    const { dispatch } = setup((ctx) => providePartial(ctx, 'workspaceController', { rename }));
    const result = await dispatch('workspace.rename', { workspaceId: 'ws-1' });
    expect(result.ok).toBe(false);
    expect(rename).not.toHaveBeenCalled();
  });

  it('workspace.archiveSession 带 stopActivity 透传', async () => {
    const archiveSession = vi.fn(async () => ({ archivedSessionIds: [] }));
    const { dispatch } = setup((ctx) => providePartial(ctx, 'workspaceController', { archiveSession }));
    await dispatch('workspace.archiveSession', { sessionId: 's-1', stopActivity: true });
    expect(archiveSession).toHaveBeenCalledWith({ sessionId: 's-1', stopActivity: true });
  });

  it('session.create 透传可选 workspaceId/cwd/agentPreset', async () => {
    const create = vi.fn(async () => ({ sessionId: 's-new', agentPreset: 'standard' }));
    const { dispatch } = setup((ctx) => providePartial(ctx, 'sessionController', { create }));
    const result = await dispatch('session.create', { workspaceId: 'ws-1', agentPreset: 'standard' });
    expect(create).toHaveBeenCalledWith({ workspaceId: 'ws-1', agentPreset: 'standard' });
    expect(result.ok).toBe(true);
  });

  it('session.prompt 缺 requestId:校验拒绝', async () => {
    const prompt = vi.fn();
    const { dispatch } = setup((ctx) => providePartial(ctx, 'sessionController', { prompt }));
    const result = await dispatch('session.prompt', {
      sessionId: 's-1',
      mode: 'queue',
      content: [{ type: 'text', text: 'hi' }],
    });
    expect(result.ok).toBe(false);
    expect(prompt).not.toHaveBeenCalled();
  });

  it('session.prompt 合法载荷透传(队列/插话)', async () => {
    const prompt = vi.fn(async () => ({ accepted: true }));
    const { dispatch } = setup((ctx) => providePartial(ctx, 'sessionController', { prompt }));
    const payload = {
      requestId: 'req-1',
      sessionId: 's-1',
      mode: 'steer',
      content: [{ type: 'text', text: '跑一下测试' }],
      clientTimeZone: 'Asia/Shanghai',
    };
    const result = await dispatch('session.prompt', payload);
    // 宿主控制器的 prompt 需要 AbortSignal;分发器不传 signal，桥给一个不中止的。
    expect(prompt).toHaveBeenCalledWith(payload, expect.any(AbortSignal));
    expect(result.ok).toBe(true);
  });

  it('session.cancel 透传 sessionId', async () => {
    const cancel = vi.fn(() => ({ cancelled: true }));
    const { dispatch } = setup((ctx) => providePartial(ctx, 'sessionController', { cancel }));
    await dispatch('session.cancel', { sessionId: 's-1' });
    expect(cancel).toHaveBeenCalledWith({ sessionId: 's-1' });
  });

  it('控制器缺失:处理器显式失败,不静默', async () => {
    const { dispatch } = setup();
    const result = await dispatch('session.list', {});
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe('HANDLER_ERROR');
  });

  it('session.list 合法游标透传', async () => {
    const list = vi.fn(async () => ({ items: [] }));
    const { dispatch } = setup((ctx) => providePartial(ctx, 'sessionController', { list }));
    await dispatch('session.list', { cursor: 'abc' });
    expect(list).toHaveBeenCalledWith({ cursor: 'abc' }, expect.any(AbortSignal));
  });
});
