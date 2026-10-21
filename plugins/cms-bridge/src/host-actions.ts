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
 *
 * 类型纪律：控制器类型直接取宿主服务的真实面（`WorkspaceController` /
 * `SessionController` / `Workspace`），没有一份手写的「同形」影子接口；读取服务
 * 走 `ctx.get(name)` 的声明合并类型面，不再用 `ctx as unknown as Record<...>`。
 * 载荷里的 id 在**这一处**边界上把 cms 传来的字符串品牌化（宿主类型要 brand，
 * JSON 只有 string），动作体本身保持纯净。
 * Type discipline: controller types are the host's real surfaces with no
 * hand-written "same shape" shadows; services are read through the typed
 * `ctx.get(name)` declaration merge instead of a Record index cast. Payload ids
 * are branded exactly at this boundary (the host wants brands, JSON has strings)
 * so the action bodies stay clean.
 *
 * @module @veren/cms-bridge/host-actions
 */

import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { WorkspaceId } from '@deepseek-ai/dsh-workspace';
import type { Workspace } from '@deepseek-ai/dsh-workspace';
import { SessionId } from '@deepseek-ai/dsh-session';
import { brandString } from '@deepseek-ai/dsh-brand';
import type { WorkspaceController, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller';
import type { SessionController, SessionRequestId } from '@deepseek-ai/dsh-api-session-controller';
import type { ActionEntry } from './protocol.js';

/**
 * 从宿主 ctx 读取一个服务；缺失时显式失败。`ctx.get` 的类型来自声明合并，
 * 因此返回值就是真实服务类型，无需任何断言。
 * Reads one host service off the ctx and fails loud when absent. `ctx.get` is
 * typed by the declaration merge, so the result is the real service type and no
 * assertion is involved.
 *
 * @param ctx 宿主上下文 / the host context
 * @param name 服务名（`keyof Context` 的子集）/ the service name
 * @returns 真实服务实例 / the real service instance
 */
function requireService<K extends string & keyof Context>(ctx: Context, name: K): NonNullable<Context[K]> {
  const value = ctx.get(name);
  if (value === undefined || value === null) {
    throw new Error(`dsh host service '${name}' is unavailable in this host composition`);
  }
  return value;
}

/**
 * 全桥唯一的「未知 → 已知」转换点。分发器交来的载荷是 `JSON.parse` 出来的
 * `unknown`，而 schemastery 的调用签名要求一个已知的输入类型；这一行就是那次
 * 转换，也是本模块里唯一的断言——其余全部由 schema 推导。
 * The only unknown→known boundary in the bridge. A payload arrives from
 * `JSON.parse` as `unknown` while schemastery's call signature requires a known
 * input type; this is that conversion, and the only assertion in this module —
 * everything else is inferred from the schema.
 *
 * @param schema 待用校验器 / the validator schema
 * @returns 把 unknown 变成 T 的解析器 / a parser turning unknown into T
 */
function parseWith<T>(schema: z<T>): (payload: unknown) => T {
  return (payload) => schema(payload as T);
}

/**
 * 把 schemastery 的校验失败翻译成 `ActionEntry.validate` 要求的字符串原因。
 * 不吞掉异常，只把它转成协议里的 INVALID_PAYLOAD 文案。
 * Turns a schemastery rejection into the string reason ActionEntry.validate
 * expects (protocol-level INVALID_PAYLOAD text), without swallowing it.
 *
 * @param schema 待用校验器 / the validator schema
 * @returns 校验函数 / the validate callback
 */
function v<T>(schema: z<T>): (payload: unknown) => string | null {
  const parse = parseWith(schema);
  return (payload) => {
    try {
      parse(payload);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  };
}

const uuidish = z.string().min(1);
const id = z.object({ workspaceId: uuidish }).required();
const sessionId = z.object({ sessionId: uuidish }).required();

/**
 * workspaceView 投影：`Workspace` → 浏览器/JSON 侧的 `WorkspaceView`。
 * 两个都是宿主真实类型；brand 在 JSON 序列化后退化成 string。
 * Projects a `Workspace` into the `WorkspaceView` the browser/JSON side reads.
 * Both are real host types; brands degrade to strings once serialized.
 *
 * @param w 工作区记录 / the workspace record
 * @returns 视图 / the view
 */
function workspaceView(w: Workspace): WorkspaceView {
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

/** 动作名 → 动作条目；联合键让「名字清单」与「条目表」编译期同步 / name → entry, kept in sync at compile time */
type HostActionMap = { readonly [K in (typeof HOST_ACTION_NAMES)[number]]: ActionEntry };

/**
 * 宿主调用的取消信号。分发器自己用 `withTimeout` 竞争超时（见 dispatcher.ts），
 * 但当前不向处理器传 signal，因此这里给一个永不中止的信号——语义与改造前一致，
 * 「超时后取消宿主侧工作」是独立议题。
 * Cancellation signal for host calls. The dispatcher races its own timeout (see
 * dispatcher.ts) but does not hand a signal to handlers today, so this is a
 * never-aborting signal: identical semantics to before, and cancelling host work
 * on timeout is a separate concern.
 */
const HOST_CALL_SIGNAL = new AbortController().signal;

/**
 * 把宿主 workspace/session 操作注册为 cms 指令动作。控制器在调用期经 ctx
 * 惰性解析(插件装配顺序无关);registry 直读投影清单,其余动词透传控制器。
 * Registers host workspace/session operations as CMS command actions.
 * Controllers resolve lazily off the ctx at call time (order-independent);
 * the list verb projects straight off the registry, everything else forwards.
 *
 * @param ctx 宿主上下文 / the host context
 * @param register 动作注册回调 / the action registration callback
 */
export function registerHostActions(
  ctx: Context,
  register: (action: string, entry: ActionEntry) => void,
): void {
  /**
   * `on` 的载荷类型由 schema 推导：同一个 schema 既做 `validate`，也是把
   * `unknown` 收窄成 `T` 的唯一入口——不需要 `payload as P` 这种断言。
   * The payload type is inferred from the schema: the same schema validates and
   * is the single place that turns `unknown` into `T`, so no `payload as P`.
   */
  const on = <T>(schema: z<T>, handler: (payload: T, ctx: Context) => unknown): ActionEntry => {
    const parse = parseWith(schema);
    return {
      handler: (payload: unknown) => handler(parse(payload), ctx),
      validate: v(schema),
    };
  };
  const wc = (context: Context): WorkspaceController => requireService(context, 'workspaceController');
  const sc = (context: Context): SessionController => requireService(context, 'sessionController');
  const reg = (context: Context) => requireService(context, 'workspaceRegistry');

  const actions: HostActionMap = {
    'workspace.list': on(z.object({}), (_, context) => ({
      workspaces: reg(context).list().map(workspaceView),
    })),
    'workspace.create': on(
      z.object({ path: z.string().required() }).required(),
      (p, context) => wc(context).create(p),
    ),
    'workspace.rename': on(
      z.object({ workspaceId: uuidish, title: z.string().required() }).required(),
      (p, context) => wc(context).rename({ workspaceId: WorkspaceId(p.workspaceId), title: p.title }),
    ),
    'workspace.delete': on(
      id,
      (p, context) => wc(context).delete({ workspaceId: WorkspaceId(p.workspaceId) }),
    ),
    'workspace.insertBefore': on(
      z.object({ workspaceId: uuidish, beforeWorkspaceId: uuidish }),
      (p, context) => wc(context).insertBefore({
        workspaceId: WorkspaceId(p.workspaceId),
        beforeWorkspaceId: p.beforeWorkspaceId === undefined ? undefined : WorkspaceId(p.beforeWorkspaceId),
      }),
    ),
    'workspace.insertSessionBefore': on(
      z.object({ workspaceId: uuidish, sessionId: uuidish, beforeSessionId: uuidish }),
      (p, context) => wc(context).insertSessionBefore({
        workspaceId: WorkspaceId(p.workspaceId),
        sessionId: SessionId(p.sessionId),
        beforeSessionId: p.beforeSessionId === undefined ? undefined : SessionId(p.beforeSessionId),
      }),
    ),
    'workspace.archiveSession': on(
      z.object({ sessionId: uuidish, stopActivity: z.boolean() }),
      (p, context) => wc(context).archiveSession({
        sessionId: SessionId(p.sessionId),
        stopActivity: p.stopActivity,
      }),
    ),
    'workspace.unarchiveSession': on(sessionId, (p, context) => wc(context).unarchiveSession({ sessionId: SessionId(p.sessionId) })),
    'workspace.pinSession': on(sessionId, (p, context) => wc(context).pinSession({ sessionId: SessionId(p.sessionId) })),
    'workspace.unpinSession': on(sessionId, (p, context) => wc(context).unpinSession({ sessionId: SessionId(p.sessionId) })),
    'session.list': on(
      z.object({ cursor: z.string() }),
      (p, context) => sc(context).list(p, HOST_CALL_SIGNAL),
    ),
    'session.search': on(
      z.object({ query: z.string().required() }).required(),
      (p, context) => sc(context).search(p, HOST_CALL_SIGNAL),
    ),
    'session.create': on(
      z.object({ workspaceId: uuidish, cwd: z.string(), sessionId: uuidish, agentPreset: z.string() }),
      (p, context) => sc(context).create({
        workspaceId: p.workspaceId === undefined ? undefined : WorkspaceId(p.workspaceId),
        cwd: p.cwd,
        sessionId: p.sessionId === undefined ? undefined : SessionId(p.sessionId),
        agentPreset: p.agentPreset,
      }),
    ),
    'session.rename': on(
      z.object({ sessionId: uuidish, title: z.string().required() }).required(),
      (p, context) => sc(context).rename({ sessionId: SessionId(p.sessionId), title: p.title }),
    ),
    'session.fork': on(
      z.object({ sessionId: uuidish, atSeq: z.natural(), allowMigration: z.boolean() }),
      (p, context) => sc(context).fork({
        sessionId: SessionId(p.sessionId),
        atSeq: p.atSeq,
        allowMigration: p.allowMigration,
      }),
    ),
    'session.prompt': on(
      z.object({
        requestId: uuidish.required(),
        sessionId: uuidish.required(),
        mode: z.union(['queue', 'steer'] as const).required(),
        content: z.array(z.object({ type: z.const('text'), text: z.string().required() }).required()).required(),
        clientTimeZone: z.string(),
      }).required(),
      (p, context) => sc(context).prompt({
        requestId: brandString<SessionRequestId>(p.requestId),
        sessionId: SessionId(p.sessionId),
        mode: p.mode,
        content: p.content,
        clientTimeZone: p.clientTimeZone,
      }, HOST_CALL_SIGNAL),
    ),
    'session.cancel': on(sessionId, (p, context) => sc(context).cancel({ sessionId: SessionId(p.sessionId) })),
    'session.projections': on(
      sessionId,
      (p, context) => sc(context).projections({ sessionId: SessionId(p.sessionId) }, HOST_CALL_SIGNAL),
    ),
    'session.selectModel': on(
      z.object({ sessionId: uuidish, provider: z.string().required(), model: z.string().required(), reasoningEffort: z.string() }).required(),
      (p, context) => sc(context).selectModel({
        sessionId: SessionId(p.sessionId),
        provider: p.provider,
        model: p.model,
        reasoningEffort: p.reasoningEffort,
      }),
    ),
    'session.modelCatalog': on(z.object({}), (_, context) => sc(context).modelCatalog()),
  };

  for (const name of HOST_ACTION_NAMES) register(name, actions[name]);
}
