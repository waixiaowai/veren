/**
 * Startup autostart recovery: resume the work an unclean shutdown interrupted.
 *
 * Three facts do the whole job, and none of them runs through a startup item
 * (creating one never fires it this boot; only the next boot would):
 *
 * 1. A disk flag claims each boot at startup and is removed only by a graceful
 *    shutdown, so "flag still present at boot" means the previous process died
 *    without reaching its cleanup.
 * 2. The real cause comes from the desktop crash-log directory, bounded to the
 *    previous run; when nothing proves a cause the prompt says so verbatim.
 * 3. The recovery prompt is delivered by this plugin, directly, during this
 *    boot - to the last active session the plugin recorded while it ran.
 *
 * Delivery is claim-first, so one crash recovers at most once: the flag is
 * claimed before the prompt is sent, and the prompt's wording never claims to
 * be the first recovery, so even a redelivery would still read true.
 *
 * 启动自启动恢复：把被异常退出打断的工作接回来。三件事完成全部工作，都不经过
 * 启动项（创建启动项本次启动不会触发，只有下次启动才会）：
 * ① 落盘标记在启动时认领、只有正常收尾才删除，因此"下次启动标记还在"即上次
 *    进程没跑到收尾；② 真实原因取自桌面崩溃日志目录并以上次启动时刻归期，证明
 *    不了原因就原样写明；③ 恢复提示词由本插件在本次启动过程中直接投递到它记录
 *    的最近活跃会话。投递先认领，一次崩溃至多恢复一次；措辞绝不自称第一次恢复。
 * @module @veren/startup-autostart-recovery
 */

import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import z from '@deepseek-ai/schemastery'
// 仅作类型引用：拉入宿主包对 'startup-autostart' 消息来源的声明合并。
// Type-only import: pulls in the host package's declaration merge that types
// the 'startup-autostart' message source.
import type {} from '@veren/startup-autostart'
import { findCrashCause, recoveryMessageText, defaultCrashLogDir } from './cause.ts'
import { clearBootFlag, claimBootFlag, readLastSession, saveLastSession } from './marker.ts'
import {
  autostartStatus, defaultStartupFolder, disableAutostart, enableAutostart,
} from './os-autostart.ts'
import type { BootClaim, CrashCause, RecoveryStatus } from './types.ts'
export type * from './types.ts'
export { UNKNOWN_CAUSE_TEXT } from './cause.ts'
export { AutostartConfigError } from './os-autostart.ts'

/** Loader name of this plugin. / 本插件在 Loader 中的名字。 */
export const name = 'startup-autostart-recovery'

/** Host services this plugin consumes. / 本插件消费的宿主服务。 */
export const inject = ['agents', 'sessions']

/** Services this plugin contributes. / 本插件提供的服务。 */
export const provide = ['startupRecovery']

/** Configuration of the recovery plugin; every member optional, safe defaults. */
export interface Config {
  /** State directory override; defaults to `$DSH_HOME/storages/startup-recovery`. */
  readonly stateDir?: string
  /** Crash-log directory override; defaults to the desktop logs directory. */
  readonly crashLogDir?: string
  /** Startup-folder override for the logon-autostart entry; defaults to the per-user folder. */
  readonly autostartFolder?: string
  /** Command line that starts DeepSeek Harness, required only to enable autostart. */
  readonly autostartCommand?: string
  /** Master switch for the recovery prompt itself; recovery stays on by default. */
  readonly recoveryEnabled?: boolean
}

/** Schemastery schema of {@link Config}. / {@link Config} 的 schemastery 定义。 */
export const Config: z<Config> = z.object({
  stateDir: z.string().default(undefined as never),
  crashLogDir: z.string().default(undefined as never),
  autostartFolder: z.string().default(undefined as never),
  autostartCommand: z.string().default(undefined as never),
  recoveryEnabled: z.boolean().default(undefined as never),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Crash recovery, last-active-session recording, and logon-autostart control. */
    startupRecovery: StartupRecoveryService
  }
}

/** Resolve the plugin's state directory from config or the DSH home. */
function resolveStateDir(config: Config): string {
  if (config.stateDir !== undefined) return config.stateDir
  const home = process.env['DSH_HOME'] ?? join(homedir(), '.dsh')
  return join(home, 'storages', 'startup-recovery')
}

/**
 * The recovery service. A plain class on purpose: it is provided under
 * `startupRecovery` by this plugin's `apply`, and its only host contact is the
 * context handed in at construction.
 */
export class StartupRecoveryService extends Service {
  readonly stateDir: string
  private readonly crashLogDir: string
  private readonly startupFolder: string
  private readonly claim: BootClaim
  private latched = false
  private report: RecoveryStatus | undefined

  /**
   * Claim this boot immediately: the claim is what bounds one crash to one
   * recovery, so it happens before any listener or trigger is wired.
   * @param ctx - host services used to resolve and deliver to the Session.
   * @param config - the plugin's resolved configuration.
   */
  constructor(ctx: Context, private readonly config: Config) {
    // The Service base registers this instance as `startupRecovery` on `ctx`.
    // Service 基类会把本实例以 `startupRecovery` 注册到 ctx 上。
    super(ctx, 'startupRecovery')
    this.stateDir = resolveStateDir(config)
    this.crashLogDir = config.crashLogDir ?? defaultCrashLogDir()
    this.startupFolder = config.autostartFolder ?? defaultStartupFolder()
    this.claim = claimBootFlag(this.stateDir, `boot-${randomUUID()}`, new Date().toISOString())
    this.recordSessions(ctx)
    this.armTrigger(ctx)
  }

  /** Read-only view of what this boot concluded and did. */
  recoveryReport(): RecoveryStatus {
    return this.report ?? {
      unclean: this.claim.unclean,
      cause: { found: false, detail: '尚未判定：启动驱动还未运行' },
      delivered: false,
      detail: 'the boot drive has not run yet',
    }
  }

  /** Read-only check of the logon-autostart entry. */
  autostart(): ReturnType<typeof autostartStatus> {
    return autostartStatus(this.startupFolder)
  }

  /** Explicit enable of the logon-autostart entry; refuses loudly when unconfigurable. */
  enableAutostart(): ReturnType<typeof autostartStatus> {
    return enableAutostart(this.startupFolder, this.config.autostartCommand ?? '')
  }

  /** The one-call undo of {@link enableAutostart}. */
  disableAutostart(): ReturnType<typeof autostartStatus> {
    return disableAutostart(this.startupFolder)
  }

  /**
   * Record every top-level session that becomes active, for the next unclean
   * recovery.
   *
   * The `agent/created` payload itself does not mark children, but the live
   * session's durable header does: `origin: 'subagent'` and a positive
   * `delegationDepth` name a subagent child. Recording such a session would
   * send the recovery prompt where the user never looks, so those are skipped;
   * a forked session (parentSession set) is still a top-level user session and
   * stays recorded.
   */
  private recordSessions(ctx: Context): void {
    const dispose = ctx.on('agent/created', ({ agent }) => {
      const header = agent.session.header
      if (header.origin === 'subagent') return
      if ((header.delegationDepth ?? 0) > 0) return
      saveLastSession(this.stateDir, { sessionId: agent.session.id, at: new Date().toISOString() })
    })
    this.ctx.effect(() => dispose, 'startup-autostart-recovery.record-sessions')
  }

  /** Drive the recovery once, after the launcher commits or on activation. */
  private armTrigger(ctx: Context): void {
    ctx.effect(() => {
      const appReady = ctx.get('appReady')
      if (appReady !== undefined) {
        return appReady.onReady(() => { void this.driveOnce() })
      }
      void this.driveOnce()
      return () => undefined
    }, 'startup-autostart-recovery.trigger')
  }

  /** Run the recovery drive once per activated service; failures never throw out. */
  private async driveOnce(): Promise<void> {
    if (this.latched) return
    this.latched = true
    const cause = findCrashCause(this.crashLogDir, this.claim.previous?.startedAt)
    const last = this.claim.unclean ? readLastSession(this.stateDir) : undefined
    const enabled = this.config.recoveryEnabled !== false
    let delivered = false
    if (last !== undefined && enabled) {
      try {
        await this.ctx.agents.withoutInitiator(() => this.deliver(last.sessionId, cause))
        delivered = true
      } catch (error: unknown) {
        // 至多一次语义：认领已完成，投递失败只记录，不会在本次启动重试。会话已
        // 被删除或废弃时走同一条路径：跳过并留下明确的日志，不报错、不乱发。
        // At-most-once: the claim is done, a failed delivery is logged only.
        // A deleted or deprecated recorded session takes the same path: skip
        // with an explicit log line, no throw, no stray delivery.
        this.ctx.logger.warn(
          `startup-autostart-recovery: the recovery prompt was not delivered to ${last.sessionId}: ${String(error)}`,
        )
      }
    }
    // exactOptionalPropertyTypes：可选成员按有无分别构造，而不是先 undefined 再补。
    // exactOptionalPropertyTypes: build the two shapes instead of patching undefined.
    let report: RecoveryStatus = {
      unclean: this.claim.unclean,
      cause,
      delivered,
      detail: delivered
        ? `delivered the recovery prompt${last === undefined ? '' : ` to ${last.sessionId}`}`
        : 'delivered nothing this boot',
    }
    if (last !== undefined) report = { ...report, lastSession: last }
    this.report = report
    this.logOutcome(report)
  }

  /** Log the outcome of one drive, one honest line. */
  private logOutcome(report: RecoveryStatus): void {
    if (!report.unclean) {
      this.ctx.logger.info('startup-autostart-recovery: the previous shutdown was clean; nothing to recover')
      return
    }
    const target = report.lastSession === undefined ? 'no recorded session' : report.lastSession.sessionId
    const verb = report.delivered ? 'delivered the recovery prompt to' : 'did not deliver to'
    this.ctx.logger.info(
      `startup-autostart-recovery: unclean shutdown detected (${report.cause.detail}); ${verb} ${target}`,
    )
  }

  /** Wake one recorded session with the recovery prompt, then confirm durability. */
  private async deliver(sessionId: string, cause: CrashCause): Promise<void> {
    const agent = await this.resolveAgent(brandString<SessionId>(sessionId))
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: recoveryMessageText(cause) }],
      source: { kind: 'startup-autostart' },
    }))
    const flushed = await this.ctx.sessions.flush(agent.session)
    if (!flushed) throw new Error('session persistence did not acknowledge the recovery message')
  }

  /** Resolve one session to its live Agent, through the Web controller when present. */
  private async resolveAgent(sessionId: SessionId): Promise<Agent> {
    const controller = this.ctx.get('sessionController')
    if (controller !== undefined) {
      const found = await controller.resolveAgent(sessionId)
      if ('error' in found) throw found.error
      return found.agent
    }
    const live = this.ctx.agents.get(sessionId)
    if (live !== undefined) return live
    return (await this.ctx.agents.resume({ resumeSessionId: sessionId })).agent
  }
}

/**
 * Mount the plugin: claim the boot flag, wire the listeners, provide the
 * service. Cleanup runs in reverse registration order, and clearing the flag
 * is deliberately last - it is the graceful-shutdown proof.
 * @param ctx - the mounting context.
 * @param config - the plugin's configuration.
 */
export function apply(ctx: Context, config: Config): void {
  // Constructing the service registers it and claims the boot flag; the only
  // extra effect is the graceful-shutdown proof.
  // 构造服务即完成注册与认领；额外的 effect 只剩正常收尾证明。
  new StartupRecoveryService(ctx, config)
  ctx.effect(() => () => { clearBootFlag(resolveStateDir(config)) }, 'startup-autostart-recovery.clear-flag')
}
