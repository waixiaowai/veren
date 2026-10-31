/**
 * Shared machinery of the host-controller action bridge: service resolution,
 * the schema→entry assembler, common payload schemas and the projection used
 * by the workspace/session action factories (see `host-workspace-actions` and
 * `host-session-actions`).
 * 宿主控制器 action 桥的公共机械：服务解析、schema→条目装配原语、公共载荷
 * schema，以及 workspace/session 动作工厂共用的投影（见
 * `host-workspace-actions` 与 `host-session-actions`）。
 *
 * 类型纪律：控制器类型直接取宿主服务的真实面（`WorkspaceController` /
 * `SessionController` / `Workspace`），没有一份手写的「同形」影子接口；读取服务
 * 走 `ctx.get(name)` 的声明合并类型面，不再用 `ctx as unknown as Record<...>`。
 * Type discipline: controller types are the host's real surfaces with no
 * hand-written "same shape" shadows; services are read through the typed
 * `ctx.get(name)` declaration merge instead of a Record index cast.
 *
 * @module @veren/cms-bridge/host-actions-support
 */

import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { Workspace } from '@deepseek-ai/dsh-workspace';
import type { WorkspaceController, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller';
import type { SessionController } from '@deepseek-ai/dsh-api-session-controller';
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
 * 单个动作的装配原语。载荷类型由 schema 推导：同一个 schema 既做 `validate`，
 * 也是把 `unknown` 收窄成 `T` 的唯一入口——不需要 `payload as P` 这种断言。
 * Assembler for one action. The payload type is inferred from the schema: the
 * same schema validates and is the single place that turns `unknown` into `T`,
 * so no `payload as P`.
 *
 * @param ctx 宿主上下文 / the host context
 * @param schema 载荷校验器 / the payload validator
 * @param handler 动作体 / the action body
 * @returns 动作条目 / the action entry
 */
export function on<T>(ctx: Context, schema: z<T>, handler: (payload: T, ctx: Context) => unknown): ActionEntry {
  const parse = parseWith(schema);
  return {
    handler: (payload: unknown) => handler(parse(payload), ctx),
    validate: v(schema),
  };
}

/** workspace 控制器（调用期惰性解析）/ the workspace controller (resolved lazily at call time) */
export function wc(context: Context): WorkspaceController {
  return requireService(context, 'workspaceController');
}

/** session 控制器（调用期惰性解析）/ the session controller (resolved lazily at call time) */
export function sc(context: Context): SessionController {
  return requireService(context, 'sessionController');
}

/** workspace 注册表（调用期惰性解析）/ the workspace registry (resolved lazily at call time) */
export function reg(context: Context) {
  return requireService(context, 'workspaceRegistry');
}

/** 通用 id 形态：非空字符串 / the common id shape: a non-empty string */
export const uuidish: z<string> = z.string().min(1);

/** 仅带 workspaceId 的载荷 / a payload carrying only a workspaceId */
export const workspaceIdPayload: z<{ workspaceId: string }> = z.object({ workspaceId: uuidish }).required();

/** 仅带 sessionId 的载荷 / a payload carrying only a sessionId */
export const sessionIdPayload: z<{ sessionId: string }> = z.object({ sessionId: uuidish }).required();

/**
 * 宿主调用的取消信号。分发器自己用 `withTimeout` 竞争超时（见 dispatcher.ts），
 * 但当前不向处理器传 signal，因此这里给一个永不中止的信号——语义与改造前一致，
 * 「超时后取消宿主侧工作」是独立议题。
 * Cancellation signal for host calls. The dispatcher races its own timeout (see
 * dispatcher.ts) but does not hand a signal to handlers today, so this is a
 * never-aborting signal: identical semantics to before, and cancelling host work
 * on timeout is a separate concern.
 */
export const HOST_CALL_SIGNAL = new AbortController().signal;

/**
 * workspaceView 投影：`Workspace` → 浏览器/JSON 侧的 `WorkspaceView`。
 * 两个都是宿主真实类型；brand 在 JSON 序列化后退化成 string。
 * Projects a `Workspace` into the `WorkspaceView` the browser/JSON side reads.
 * Both are real host types; brands degrade to strings once serialized.
 *
 * @param w 工作区记录 / the workspace record
 * @returns 视图 / the view
 */
export function workspaceView(w: Workspace): WorkspaceView {
  return {
    workspaceId: w.id,
    path: w.path,
    title: w.title,
    sessionIds: w.sessionIds,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
  };
}
