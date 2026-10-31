/**
 * 宿主控制器 action 桥:把 dsh 宿主的 workspace/session 控制器(dsh Web UI 的
 * 同一服务层)映射为 cms 指令动作。类型 + 载荷两端收紧:每个动作带 schemastery
 * 校验器,载荷先过校验再透传到控制器方法;控制器缺失时处理器显式失败,不静默。
 * 本体只做装配——每个动作由 `host-workspace-actions` / `host-session-actions`
 * 的具名工厂构建,这里按清单顺序登记。
 *
 * The host-controller action bridge: maps the DSH host's workspace/session
 * controllers (the same service layer the DSH Web UI talks to) onto CMS
 * command actions. Type + payload are tightened on both ends: every action
 * carries a schemastery validator, payloads validate before forwarding, and a
 * missing controller fails the handler explicitly instead of silently.
 * This module only assembles — each action is built by a named factory in
 * `host-workspace-actions` / `host-session-actions` and registered here in
 * list order.
 *
 * @module @veren/cms-bridge/host-actions
 */

import type { Context } from '@deepseek-ai/cordis';
import type { ActionEntry } from './protocol.js';
import {
  workspaceList,
  workspaceCreate,
  workspaceRename,
  workspaceDelete,
  workspaceInsertBefore,
  workspaceInsertSessionBefore,
  workspaceArchiveSession,
  workspaceUnarchiveSession,
  workspacePinSession,
  workspaceUnpinSession,
} from './host-workspace-actions.js';
import {
  sessionList,
  sessionSearch,
  sessionCreate,
  sessionRename,
  sessionFork,
  sessionPrompt,
  sessionCancel,
  sessionProjections,
  sessionSelectModel,
  sessionModelCatalog,
} from './host-session-actions.js';

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
 * 把宿主 workspace/session 操作注册为 cms 指令动作。控制器在调用期经 ctx
 * 惰性解析(插件装配顺序无关)——这个性质由工厂模块保证,这里只把每个动作
 * 条目按清单顺序交给注册回调。
 * Registers host workspace/session operations as CMS command actions.
 * Controllers resolve lazily off the ctx at call time (order-independent) —
 * guaranteed by the factory modules; this body only hands each action entry
 * to the registration callback in list order.
 *
 * @param ctx 宿主上下文 / the host context
 * @param register 动作注册回调 / the action registration callback
 */
export function registerHostActions(
  ctx: Context,
  register: (action: string, entry: ActionEntry) => void,
): void {
  const actions: HostActionMap = {
    'workspace.list': workspaceList(ctx),
    'workspace.create': workspaceCreate(ctx),
    'workspace.rename': workspaceRename(ctx),
    'workspace.delete': workspaceDelete(ctx),
    'workspace.insertBefore': workspaceInsertBefore(ctx),
    'workspace.insertSessionBefore': workspaceInsertSessionBefore(ctx),
    'workspace.archiveSession': workspaceArchiveSession(ctx),
    'workspace.unarchiveSession': workspaceUnarchiveSession(ctx),
    'workspace.pinSession': workspacePinSession(ctx),
    'workspace.unpinSession': workspaceUnpinSession(ctx),
    'session.list': sessionList(ctx),
    'session.search': sessionSearch(ctx),
    'session.create': sessionCreate(ctx),
    'session.rename': sessionRename(ctx),
    'session.fork': sessionFork(ctx),
    'session.prompt': sessionPrompt(ctx),
    'session.cancel': sessionCancel(ctx),
    'session.projections': sessionProjections(ctx),
    'session.selectModel': sessionSelectModel(ctx),
    'session.modelCatalog': sessionModelCatalog(ctx),
  };

  for (const name of HOST_ACTION_NAMES) register(name, actions[name]);
}
