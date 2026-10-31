/**
 * Named factories for the bridge's `workspace.*` actions: each factory binds
 * a schemastery payload schema to one workspace-controller call (the list
 * verb reads the registry directly). Controllers resolve lazily off the ctx
 * at call time, so registration order never matters.
 * action 桥 `workspace.*` 动作的具名工厂：每个工厂把一个 schemastery 载荷
 * schema 绑定到一次 workspace 控制器调用（list 直读注册表）。控制器在调用期
 * 经 ctx 惰性解析，注册顺序无关。
 *
 * @module @veren/cms-bridge/host-workspace-actions
 */

import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { WorkspaceId } from '@deepseek-ai/dsh-workspace';
import { SessionId } from '@deepseek-ai/dsh-session';
import type { ActionEntry } from './protocol.js';
import { on, reg, wc, sessionIdPayload, uuidish, workspaceIdPayload, workspaceView } from './host-actions-support.js';

/** `workspace.list`：注册表直读投影清单 / reads the projection list straight off the registry */
export const workspaceList = (ctx: Context): ActionEntry => on(ctx, z.object({}), (_, context) => ({
  workspaces: reg(context).list().map(workspaceView),
}));

/** `workspace.create` / create a workspace */
export const workspaceCreate = (ctx: Context): ActionEntry => on(
  ctx,
  z.object({ path: z.string().required() }).required(),
  (p, context) => wc(context).create(p),
);

/** `workspace.rename` / rename a workspace */
export const workspaceRename = (ctx: Context): ActionEntry => on(
  ctx,
  z.object({ workspaceId: uuidish, title: z.string().required() }).required(),
  (p, context) => wc(context).rename({ workspaceId: WorkspaceId(p.workspaceId), title: p.title }),
);

/** `workspace.delete` / delete a workspace */
export const workspaceDelete = (ctx: Context): ActionEntry => on(
  ctx,
  workspaceIdPayload,
  (p, context) => wc(context).delete({ workspaceId: WorkspaceId(p.workspaceId) }),
);

/** `workspace.insertBefore` / insert a workspace before another */
export const workspaceInsertBefore = (ctx: Context): ActionEntry => on(
  ctx,
  z.object({ workspaceId: uuidish, beforeWorkspaceId: uuidish }),
  (p, context) => wc(context).insertBefore({
    workspaceId: WorkspaceId(p.workspaceId),
    beforeWorkspaceId: p.beforeWorkspaceId === undefined ? undefined : WorkspaceId(p.beforeWorkspaceId),
  }),
);

/** `workspace.insertSessionBefore` / insert a session before another in a workspace */
export const workspaceInsertSessionBefore = (ctx: Context): ActionEntry => on(
  ctx,
  z.object({ workspaceId: uuidish, sessionId: uuidish, beforeSessionId: uuidish }),
  (p, context) => wc(context).insertSessionBefore({
    workspaceId: WorkspaceId(p.workspaceId),
    sessionId: SessionId(p.sessionId),
    beforeSessionId: p.beforeSessionId === undefined ? undefined : SessionId(p.beforeSessionId),
  }),
);

/** `workspace.archiveSession` / archive a session out of a workspace */
export const workspaceArchiveSession = (ctx: Context): ActionEntry => on(
  ctx,
  z.object({ sessionId: uuidish, stopActivity: z.boolean() }),
  (p, context) => wc(context).archiveSession({
    sessionId: SessionId(p.sessionId),
    stopActivity: p.stopActivity,
  }),
);

/** `workspace.unarchiveSession` / restore an archived session */
export const workspaceUnarchiveSession = (ctx: Context): ActionEntry => on(
  ctx,
  sessionIdPayload,
  (p, context) => wc(context).unarchiveSession({ sessionId: SessionId(p.sessionId) }),
);

/** `workspace.pinSession` / pin a session in its workspace */
export const workspacePinSession = (ctx: Context): ActionEntry => on(
  ctx,
  sessionIdPayload,
  (p, context) => wc(context).pinSession({ sessionId: SessionId(p.sessionId) }),
);

/** `workspace.unpinSession` / unpin a session */
export const workspaceUnpinSession = (ctx: Context): ActionEntry => on(
  ctx,
  sessionIdPayload,
  (p, context) => wc(context).unpinSession({ sessionId: SessionId(p.sessionId) }),
);
