/**
 * 宿主控制器 action 桥:把 dsh 宿主的 workspace/session 控制器(dsh Web UI 的
 * 同一服务层)映射为 cms 指令动作。类型 + 载荷两端收紧:每个动作带 schemastery
 * 校验器,载荷先过校验再透传到控制器方法;控制器缺失时处理器显式失败,不静默。
 *
 * The host-controller action bridge: maps the DSH host's workspace/session
 * controllers (the same service layer the DSH Web UI talks to) onto CMS
 * command actions. Type + payload are tightened on both ends: every action
 * carries a schemastery validator, payloads validate before forwarding, and a
 * missing controller fails the handler explicitly instead of silently.
 */

import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { ActionEntry, ActionHandler } from './protocol.js';

/** WorkspaceView 投影(与 dsh workspace-controller types.ts 同形)/ the WorkspaceView projection */
export interface WorkspaceView {
  workspaceId: string;
  path: string;
  title: string;
  sessionIds: readonly string[];
  createdAt: string;
  updatedAt: string;
}

/** 结构化最小接口:宿主对象按同形 duck-typing 消费,零 dsh 依赖 / structural minimal views: duck-typed, zero DSH imports */
interface WorkspaceLike {
  id: string;
  path: string;
  title: string;
  sessionIds: readonly string[];
  createdAt: string;
  updatedAt: string;
  setTitle(title: string): Promise<void>;
}

interface WorkspaceRegistryLike {
  list(): WorkspaceLike[];
  create(path: string, title?: string): Promise<WorkspaceLike>;
  delete(id: string): Promise<boolean>;
  insertBefore(id: string, beforeId?: string): Promise<readonly string[]>;
  insertSessionBefore(id: string, sessionId: string, beforeSessionId?: string): Promise<readonly string[]>;
  archiveSession(sessionId: string, options?: { stopActivity?: boolean }): Promise<void>;
  unarchiveSession(sessionId: string): Promise<void>;
  pinSession(sessionId: string): Promise<void>;
  unpinSession(sessionId: string): Promise<void>;
}

interface WorkspaceControllerLike {
  create(request: { path: string }): Promise<{ workspace: WorkspaceView; created: boolean }>;
  rename(request: { workspaceId: string; title: string }): Promise<{ workspace: WorkspaceView }>;
  delete(request: { workspaceId: string }): Promise<{ deleted: true }>;
  insertBefore(request: { workspaceId: string; beforeWorkspaceId?: string }): Promise<{ workspaceIds: readonly string[] }>;
  insertSessionBefore(request: { workspaceId: string; sessionId: string; beforeSessionId?: string }): Promise<{ workspaceIds: readonly string[] }>;
  archiveSession(request: { sessionId: string; stopActivity?: boolean }): Promise<{ archivedSessionIds: readonly string[] }>;
  unarchiveSession(request: { sessionId: string }): Promise<{ archivedSessionIds: readonly string[] }>;
  pinSession(request: { sessionId: string }): Promise<{ pinnedSessionIds: readonly string[] }>;
  unpinSession(request: { sessionId: string }): Promise<{ pinnedSessionIds: readonly string[] }>;
}

interface SessionControllerLike {
  list(request: { cursor?: string }, signal?: AbortSignal): Promise<{ items: readonly unknown[] }>;
  search(request: { query: string }, signal?: AbortSignal): Promise<{ items: readonly unknown[] }>;
  create(request: { workspaceId?: string; cwd?: string; sessionId?: string; agentPreset?: string }): Promise<{ sessionId: string; agentPreset?: string }>;
  rename(request: { sessionId: string; title: string }): Promise<unknown>;
  fork(request: { sessionId: string; atSeq?: number; allowMigration?: boolean }): Promise<unknown>;
  prompt(request: {
    requestId: string;
    sessionId: string;
    mode: 'queue' | 'steer';
    content: readonly { type: 'text'; text: string }[];
    clientTimeZone?: string;
  }, signal?: AbortSignal): Promise<unknown>;
  cancel(request: { sessionId: string }): unknown;
  projections(request: { sessionId: string }, signal?: AbortSignal): Promise<unknown>;
  selectModel(request: { sessionId: string; provider: string; model: string; reasoningEffort?: string }): Promise<unknown>;
  modelCatalog(): Promise<unknown>;
}

/** 从宿主 ctx 读取控制器(缺失=undefined,处理器显式失败)/ reads a host controller off the ctx (undefined → the handler fails explicitly) */
function controller<T>(ctx: Context, name: string): T {
  const value = (ctx as unknown as Record<string, unknown>)[name];
  if (value === undefined || value === null) {
    throw new Error(`dsh host service '${name}' is unavailable in this host composition`);
  }
  return value as T;
}

/** z schema → ActionEntry.validate 适配器(失败返回原因文本)/ adapts a schema into an ActionEntry validator */
function v(schema: z<any>): (payload: unknown) => string | null {
  return (payload) => {
    try {
      (schema as unknown as (value: unknown) => unknown)(payload);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  };
}

const uuidish = z.string().min(1);
const id = z.object({ workspaceId: uuidish }).required();
const sessionId = z.object({ sessionId: uuidish }).required();

/** workspaceView 投影(对齐 dsh workspace-controller 的浏览器投影)/ projects a Workspace into the browser view shape */
function workspaceView(w: WorkspaceLike): WorkspaceView {
  return {
    workspaceId: w.id,
    path: w.path,
    title: w.title,
    sessionIds: w.sessionIds,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
  };
}

/** 登记的全部动作名(消费方 Inventory 用)/ every action name this module registers */
export const HOST_ACTION_NAMES = [
  'workspace.list',
  'workspace.create',
  'workspace.rename',
  'workspace.delete',
  'workspace.insertBefore',
  'workspace.insertSessionBefore',
  'workspace.archiveSession',
  'workspace.unarchiveSession',
  'workspace.pinSession',
  'workspace.unpinSession',
  'session.list',
  'session.search',
  'session.create',
  'session.rename',
  'session.fork',
  'session.prompt',
  'session.cancel',
  'session.projections',
  'session.selectModel',
  'session.modelCatalog',
] as const;

/**
 * 把宿主 workspace/session 操作注册为 cms 指令动作。控制器在调用期经 ctx
 * 惰性解析(插件装配顺序无关);registry 直读投影清单,其余动词透传控制器。
 * Registers host workspace/session operations as CMS command actions.
 * Controllers resolve lazily off the ctx at call time (order-independent);
 * the list verb projects straight off the registry, everything else forwards.
 */
export function registerHostActions(
  ctx: Context,
  register: (action: string, entry: ActionEntry) => void,
): void {
  const on = <P>(schema: z<any>, handler: (payload: P, ctx: Context) => unknown): ActionEntry => ({
    handler: ((payload: unknown) => handler(payload as P, ctx)) as ActionHandler,
    validate: v(schema),
  });
  const wc = (ctx: Context) => controller<WorkspaceControllerLike>(ctx, 'workspaceController');
  const sc = (ctx: Context) => controller<SessionControllerLike>(ctx, 'sessionController');
  const reg = (ctx: Context) => controller<WorkspaceRegistryLike>(ctx, 'workspaceRegistry');

  const actions: Record<string, ActionEntry> = {
    'workspace.list': on(z.object({}), () => ({
      workspaces: reg(ctx).list().map(workspaceView),
    })),
    'workspace.create': on(
      z.object({ path: z.string().required() }).required(),
      (p: { path: string }, ctx) => wc(ctx).create(p),
    ),
    'workspace.rename': on(
      z.object({ workspaceId: uuidish, title: z.string().required() }).required(),
      (p: { workspaceId: string; title: string }, ctx) => wc(ctx).rename(p),
    ),
    'workspace.delete': on(
      id,
      (p: { workspaceId: string }, ctx) => wc(ctx).delete(p),
    ),
    'workspace.insertBefore': on(
      z.object({ workspaceId: uuidish, beforeWorkspaceId: uuidish }),
      (p: { workspaceId: string; beforeWorkspaceId?: string }, ctx) => wc(ctx).insertBefore(p),
    ),
    'workspace.insertSessionBefore': on(
      z.object({ workspaceId: uuidish, sessionId: uuidish, beforeSessionId: uuidish }),
      (p: { workspaceId: string; sessionId: string; beforeSessionId?: string }, ctx) => wc(ctx).insertSessionBefore(p),
    ),
    'workspace.archiveSession': on(
      z.object({ sessionId: uuidish, stopActivity: z.boolean() }),
      (p: { sessionId: string; stopActivity?: boolean }, ctx) => wc(ctx).archiveSession(p),
    ),
    'workspace.unarchiveSession': on(sessionId, (p: { sessionId: string }, ctx) => wc(ctx).unarchiveSession(p)),
    'workspace.pinSession': on(sessionId, (p: { sessionId: string }, ctx) => wc(ctx).pinSession(p)),
    'workspace.unpinSession': on(sessionId, (p: { sessionId: string }, ctx) => wc(ctx).unpinSession(p)),
    'session.list': on(
      z.object({ cursor: z.string() }),
      (p: { cursor?: string }, ctx) => sc(ctx).list(p),
    ),
    'session.search': on(
      z.object({ query: z.string().required() }).required(),
      (p: { query: string }, ctx) => sc(ctx).search(p),
    ),
    'session.create': on(
      z.object({ workspaceId: uuidish, cwd: z.string(), sessionId: uuidish, agentPreset: z.string() }),
      (p: { workspaceId?: string; cwd?: string; sessionId?: string; agentPreset?: string }, ctx) => sc(ctx).create(p),
    ),
    'session.rename': on(
      z.object({ sessionId: uuidish, title: z.string().required() }).required(),
      (p: { sessionId: string; title: string }, ctx) => sc(ctx).rename(p),
    ),
    'session.fork': on(
      z.object({ sessionId: uuidish, atSeq: z.natural(), allowMigration: z.boolean() }),
      (p: { sessionId: string; atSeq?: number; allowMigration?: boolean }, ctx) => sc(ctx).fork(p),
    ),
    'session.prompt': on(
      z.object({
        requestId: uuidish.required(),
        sessionId: uuidish.required(),
        mode: z.union(['queue', 'steer'] as const).required(),
        content: z.array(z.object({ type: 'text', text: z.string().required() }).required()).required(),
        clientTimeZone: z.string(),
      }).required(),
      (p: Parameters<SessionControllerLike['prompt']>[0], ctx) => sc(ctx).prompt(p),
    ),
    'session.cancel': on(sessionId, (p: { sessionId: string }, ctx) => sc(ctx).cancel(p)),
    'session.projections': on(sessionId, (p: { sessionId: string }, ctx) => sc(ctx).projections(p)),
    'session.selectModel': on(
      z.object({ sessionId: uuidish, provider: z.string().required(), model: z.string().required(), reasoningEffort: z.string() }).required(),
      (p: { sessionId: string; provider: string; model: string; reasoningEffort?: string }, ctx) => sc(ctx).selectModel(p),
    ),
    'session.modelCatalog': on(z.object({}), () => sc(ctx).modelCatalog()),
  };

  for (const name of HOST_ACTION_NAMES) {
    const entry = actions[name];
    if (!entry) throw new Error(`host action '${name}' has no entry (inventory out of sync)`);
    register(name, entry);
  }
}
