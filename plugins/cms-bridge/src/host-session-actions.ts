/**
 * Named factories for the bridge's `session.*` actions: each factory binds a
 * schemastery payload schema to one session-controller call. Controllers
 * resolve lazily off the ctx at call time, so registration order never
 * matters.
 * action 桥 `session.*` 动作的具名工厂：每个工厂把一个 schemastery 载荷
 * schema 绑定到一次 session 控制器调用。控制器在调用期经 ctx 惰性解析，
 * 注册顺序无关。
 *
 * @module @veren/cms-bridge/host-session-actions
 */

import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { WorkspaceId } from '@deepseek-ai/dsh-workspace';
import { SessionId } from '@deepseek-ai/dsh-session';
import { brandString } from '@deepseek-ai/dsh-brand';
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller';
import type { ActionEntry } from './protocol.js';
import { HOST_CALL_SIGNAL, on, sc, sessionIdPayload, uuidish } from './host-actions-support.js';

/** `session.list` / list sessions with an optional cursor */
export const sessionList = (ctx: Context): ActionEntry => on(
  ctx,
  z.object({ cursor: z.string() }),
  (p, context) => sc(context).list(p, HOST_CALL_SIGNAL),
);

/** `session.search` / full-text search sessions */
export const sessionSearch = (ctx: Context): ActionEntry => on(
  ctx,
  z.object({ query: z.string().required() }).required(),
  (p, context) => sc(context).search(p, HOST_CALL_SIGNAL),
);

/** `session.create` / create a session in a workspace */
export const sessionCreate = (ctx: Context): ActionEntry => on(
  ctx,
  z.object({ workspaceId: uuidish, cwd: z.string(), sessionId: uuidish, agentPreset: z.string() }),
  (p, context) => sc(context).create({
    workspaceId: p.workspaceId === undefined ? undefined : WorkspaceId(p.workspaceId),
    cwd: p.cwd,
    sessionId: p.sessionId === undefined ? undefined : SessionId(p.sessionId),
    agentPreset: p.agentPreset,
  }),
);

/** `session.rename` / rename a session */
export const sessionRename = (ctx: Context): ActionEntry => on(
  ctx,
  z.object({ sessionId: uuidish, title: z.string().required() }).required(),
  (p, context) => sc(context).rename({ sessionId: SessionId(p.sessionId), title: p.title }),
);

/** `session.fork` / fork a session at (or after) a sequence point */
export const sessionFork = (ctx: Context): ActionEntry => on(
  ctx,
  z.object({ sessionId: uuidish, atSeq: z.natural(), allowMigration: z.boolean() }),
  (p, context) => sc(context).fork({
    sessionId: SessionId(p.sessionId),
    atSeq: p.atSeq,
    allowMigration: p.allowMigration,
  }),
);

/** `session.prompt` / enqueue or steer a user prompt */
export const sessionPrompt = (ctx: Context): ActionEntry => on(
  ctx,
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
);

/** `session.cancel` / cancel the running turn */
export const sessionCancel = (ctx: Context): ActionEntry => on(
  ctx,
  sessionIdPayload,
  (p, context) => sc(context).cancel({ sessionId: SessionId(p.sessionId) }),
);

/** `session.projections` / read a session's projections */
export const sessionProjections = (ctx: Context): ActionEntry => on(
  ctx,
  sessionIdPayload,
  (p, context) => sc(context).projections({ sessionId: SessionId(p.sessionId) }, HOST_CALL_SIGNAL),
);

/** `session.selectModel` / switch the session's model */
export const sessionSelectModel = (ctx: Context): ActionEntry => on(
  ctx,
  z.object({ sessionId: uuidish, provider: z.string().required(), model: z.string().required(), reasoningEffort: z.string() }).required(),
  (p, context) => sc(context).selectModel({
    sessionId: SessionId(p.sessionId),
    provider: p.provider,
    model: p.model,
    reasoningEffort: p.reasoningEffort,
  }),
);

/** `session.modelCatalog` / list the available models */
export const sessionModelCatalog = (ctx: Context): ActionEntry => on(ctx, z.object({}), (_, context) => sc(context).modelCatalog());
