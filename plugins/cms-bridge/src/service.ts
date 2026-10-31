/**
 * 对外服务门面：其他插件注入 CmsBridge 令牌即可注册 action、上报事件、查询
 * 运行状态、更换凭证与更新节点身份。构造即注册为 'cmsBridge' 服务。
 * The public facade: other plugins inject the CmsBridge token to register
 * actions, report events, read status, rotate the credential and update the
 * node identity. Constructing registers the 'cmsBridge' service.
 */

import type { Context } from '@deepseek-ai/cordis';
import { Service } from '@deepseek-ai/cordis';
import type { Dispatcher } from './dispatcher.js';
import type { ConnectionConfig, ConnectionManager } from './connection.js';
import type { BridgeStatus } from './protocol.js';
import { CmsBridge } from './protocol.js';
import type { NodeIdentity } from './identity.js';

/** 对外服务门面 / the public service facade */
export class CmsBridgeService extends Service {
  constructor(ctx: Context, readonly manager: ConnectionManager) {
    super(ctx, CmsBridge);
  }

  /** 注册一个 action 映射 / declares one action mapping */
  registerAction(action: string, entry: Parameters<Dispatcher['register']>[1]): void {
    this.manager.dispatcher.register(action, entry);
    this.ctx.logger.info('cms-bridge: action registered: %s', action);
  }

  /** 注销一个 action 映射 / removes one action mapping */
  unregisterAction(action: string): boolean {
    return this.manager.dispatcher.unregister(action);
  }

  /** 主动上报一条事件(断线自动补报)/ reports one event (auto-replayed when offline) */
  report(name: string, payload?: unknown): { queued: boolean; id: string } {
    return this.manager.reporter.report(name, payload);
  }

  /** 运行状态快照 / the runtime status snapshot */
  status(): BridgeStatus {
    return this.manager.status();
  }

  /** 更换凭证(等待重配置状态下会自动恢复连接)/ applies a new credential (auto-resumes from the parked state) */
  setCredential(token: string): void {
    this.manager.setCredential(token);
  }

  /** 当前节点身份 / the current node identity */
  identity(): NodeIdentity {
    return this.manager.identity();
  }

  /** 更新节点身份(连接中立即重新上报)/ updates the node identity (re-reports immediately while connected) */
  setIdentity(identity: NodeIdentity): void {
    this.manager.setIdentity(identity);
  }

  /** 只读配置视图 / the readonly config view */
  connectionConfig(): Readonly<ConnectionConfig> {
    return this.manager.connectionConfig;
  }
}
